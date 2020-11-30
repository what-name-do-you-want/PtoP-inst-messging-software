const async = require("async");
const protobuf = require("./test_pb");
const utils = require("./utils");
const sendError = require("./dealError");
const { Socket } = require("dgram");
const err_types = protobuf.Error.Error_type;
let redis_client;
let mysql_client;
const unsend_msg = 0b10000000;
const addfriendfromself = 0b01000000;
const addfriendfromother = 0b00100000;
const seen = 0b00010000;
const del_friend = 0b00001000;
const change_name = 0b00000100;
const change_head = 0b00000010;
function dealHeartBeatReq(lt_socket_id, socket, req_to_server, redis, mysql) {
    //这个socket是动态的。
    console.log("dealHeartBeatReq");
    redis_client = redis;
    mysql_client = mysql;
    let heart_beat_req = req_to_server.getHeartBeatReq();
    let short_token = heart_beat_req.getShortToken();
    let in_ip = heart_beat_req.getInIp();
    let in_port = heart_beat_req.getInPort();
    let out_ip = socket.remoteAddress;
    let out_port = socket.remotePort;
    let id;
    let bitmap;
    async.auto({
        check_token: function (callback) {
            redis_client.get("short_token:" + short_token, function (err, reply) {
                if (err) {
                    callback(err_types.UNKNOWN_HEARTBEAT_ERR);
                }
                else if (reply === null) {
                    //说明token过期了。

                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN);
                }
                else {
                    id = reply;
                    // console.log("my id:"+id);
                    callback(null);
                }
            });
        },
        set_ipport_redis: ['check_token', function (res, callback) {
            console.log("id:"+id);
            redis_client.setex("id:" + id, 120, JSON.stringify({
                "in_ip": in_ip,
                "in_port": in_port,
                "out_ip": utils.ip_str_to_num(out_ip),
                "out_port": out_port
            }), function (err, reply) {
                if (err) {
                    callback(err_types.UNKNOWN_HEARTBEAT_ERR);
                }
                else {
                    // console.log(reply);
                    callback(null);
                }
            });
        }],

        set_ltsock_redis: ["check_token", function (res, callback) {
            redis_client.setex("id:" + id + "socket:", 130, lt_socket_id, () => {
                callback(null);
            });
        }],
        get_bitmap_redis: ["check_token", function (res, callback) {
            redis_client.get("id:" + id + "bitmap:", (err, reply) => {
                if (reply) {
                    bitmap = Number(reply);
                }
                callback(null);
            })
        }]
    }, function (err, results) {
        if (err != null) {
            console.log(err);
            sendError(socket, err);
        }
        else {
            // console.log(`remote in_ip:${in_ip}`);
            console.log(`remote in_port:${in_port}`);
            rspHeartBeat(socket);
            if (bitmap) {
                sendRsp(socket, id, bitmap);
            }
        }

    });

}

function sendRsp(socket, id, bitmap) {
    let unchange = 0b11111111;
    async.parallel([
        function (callback) {
            if (bitmap & addfriendfromself)
                rspAddfriendFromSelf(socket, id, callback);
            else {
                callback(null, unchange);
            }
        },
        function (callback) {
            if (bitmap & addfriendfromother)
                rspAddfriendFromOther(socket, id, callback);
            else {
                callback(null, unchange);
            }
        },
        function (callback) {
            if (bitmap & unsend_msg)
                rspUnreceivedMsg(socket, id, callback);
            else {
                callback(null, unchange);
            }
        },
        function (callback) {
            if (bitmap & del_friend)
                rspDelFriend(socket, id, callback);
            else {
                callback(null, unchange);
            }
        },
        function (callback) {
            if (bitmap & seen)
                rspSeen(socket, id, callback);
            else {
                callback(null, unchange);
            }
        },
        function (callback) {
            if (bitmap & change_name) {
                rspChangeName(socket, id, callback);
            } else {
                callback(null, unchange);
            }
        },
        function (callback){
            if(bitmap&change_head){
                rspChangeHeadpic(socket,id,callback);
            }else{
                callback(null,unchange);
            }
        }
    ], (err, results) => {
        if (err) {
            console.log(err);
        }
        console.log(results);
        let new_bitmap = bitmap;
        for (let i = 0; i < results.length; i++) {
            new_bitmap = new_bitmap & results[i];
        }
        console.log(new_bitmap);
        redis_client.setex("id:" + id + "bitmap:", 3600 * 24 * 30 + 10, new_bitmap, () => {
        });

        console.log('dealHeartBeatReq end');
    })
}
function rspChangeName(socket, id, callback1) {
    let bitmap = 0b11111111;
    let fail_friends;
    let fail_send_friends = [];
    let allready_send = [];
    const fail_get_friendlist = 1;

    async.auto({
        //获取修改了名字的redis friendlist
        //将新名字发过去
        get_change_name_friendlist: (callback) => {
            console.log("get_change_name_friendlist")
            redis_client.lrange("id:" + id + "friendNameChangeList:", 0, -1, (err, reply) => {
                if (err || reply === null) {
                    console.log("deal heart beat req change name 152行");
                    if (reply === null) {
                        console.log("no exist reply 156");
                    }
                    callback(fail_get_friendlist);
                } else {
                    fail_friends = reply;
                    callback(null);
                }
            })
        },
        solve_all: ['get_change_name_friendlist',(result, callback) => {
            console.log("solve all");
            let complete = 0;
            for (let i = 0; i < fail_friends.length; i++) {
                let group = JSON.parse(fail_friends[i]);
                if (!allready_send.includes(group.id)) {
                    allready_send.push(group.id);
                    let rsp = setChangeNameRelay(group.id, group.name);
                    let buf = utils.toBufferAndPrependLen(rsp);
                    console.log(`rspChangeName len:${buf.length}`);
                    socket.write(buf, (err) => {
                        if (err) {
                            fail_send_friends.push(fail_friends[i]);
                            console.log("deal heartbeat change name solve all err!");
                            console.log(err);
                        }
                        complete++;
                        if (complete === fail_friends.length) {
                            callback(null);
                        }
                    })
                } else {
                    complete++;
                    if (complete === fail_friends.length) {
                        callback(null);
                    }
                }
            }
        }],
        set_unsend_msg: ['solve_all',(result, callback) => {
            console.log("set unsend msg");
            redis_client.del("id:" + id + "friendNameChangeList:", (err) => {
                if (err) {
                    console.log("heart beat change name set unsend msg err");
                    console.log(err);
                    callback(null, false);
                } else {
                    if (fail_send_friends.length !== 0) {
                        let complete = 0;
                        for (let i = 0; i < fail_send_friends.length; i++) {
                            redis_client.rpush("id:" + id + "friendNameChangeList:", fail_send_friends[i], (err) => {
                                if (err) {
                                    console.log("set fail send friends heart beat change name set unsend msg");
                                    console.log(err);
                                }
                                complete++;
                                if (complete === fail_send_friends.length) {
                                    callback(null);
                                }
                            })
                        }
                    } else {
                        callback(null);
                    }
                }
            })
        }],
        set_expire: ['set_unsend_msg',(result, callback) => {
            console.log("set expire");
            if (fail_send_friends.length !== 0) {
                redis_client.expire("id:" + id + "friendNameChangeList:", 3600 * 24 * 30 + 10, (err) => {
                    if (err) {
                        console.log("heart beat change name set expire");
                        console.log(err);
                    }
                    callback(null);
                })
            }
            callback(null);
        }]

    }, (err) => {
        if (fail_send_friends.length != 0 || err) {
            callback1(null, bitmap);
        } else {
            callback1(null, ~change_name);
        }
    })
}

function setChangeNameRelay(id,name){
    let rsp_to_client=new protobuf.RspToClient();
    let relay =  new protobuf.ChangeName.RelayToFriend();
    relay.setId(id);
    relay.setName(name);
    rsp_to_client.setChangeNameRelay(relay)
    return rsp_to_client;
}

function rspChangeHeadpic(socket,id,callback1){
    const fail_get_friendlist = 1;
    let fail_friends;
    let allready_send = [];
    let fail_send_friends = [];
    async.auto({
        get_Change_Headpic_friendlist:(callback) => {
            console.log("get change headpic friendlist");
            redis_client.lrange("id:" + id + "friendHeadChangeList:", 0, -1, (err, reply) => {
                if (err || reply === null) {
                    console.log("deal heart beat req change headpic get change friendlist");
                    if (reply === null) {
                        console.log("no exist reply change headpic get change friendlist");
                    }
                    callback(fail_get_friendlist);
                } else {
                    fail_friends = reply;
                    callback(null);
                }
            })
        },
        solve_all: ['get_Change_Headpic_friendlist',(result, callback) => {
            //TODO
            console.log("solve all");
            let complete = 0;
            for (let i = 0; i < fail_friends.length; i++) {
                let group = fail_friends[i];
                if (!allready_send.includes(group)) {
                    allready_send.push(group);
                    mysql_client.query("select headpic from userinfo where id = ?",[group],(err,sql_result)=>{
                        if(err){
                            console.log("err in mysql change headpic  get heapic heart beat");
                            fail_send_friends.push(fail_friends[i]);
                            complete++;
                            if (complete === fail_friends.length) {
                                callback(null);
                            }
                        }else{
                            let rsp = setChangeHeadpicRelay(group, Buffer.from(sql_result[0].headpic));
                            let buf = utils.toBufferAndPrependLen(rsp);
                            console.log(`rspChangeHead len:${buf.length}`);
                            socket.write(buf, (err) => {
                                if (err) {
                                    fail_send_friends.push(fail_friends[i]);
                                    console.log("deal heartbeat change head solve all err!");
                                    console.log(err);
                                }
                                
                                complete++;
                                if (complete === fail_friends.length) {
                                    callback(null);
                                }
                            })
                        }
                    })
                } else {
                    complete++;
                    if (complete === fail_friends.length) {
                        callback(null);
                    }
                }
            }
        }],
        set_unsend_msg: ['solve_all',(result, callback) => {
            console.log("set unsend msg");
            redis_client.del("id:" + id + "friendHeadChangeList:", (err) => {
                if (err) {
                    console.log("heart beat change head set unsend msg err");
                    console.log(err);
                    callback(null, false);
                } else {
                    if (fail_send_friends.length !== 0) {
                        let complete = 0;
                        for (let i = 0; i < fail_send_friends.length; i++) {
                            redis_client.rpush("id:" + id + "friendHeadChangeList:", fail_send_friends[i], (err) => {
                                if (err) {
                                    console.log("set fail send friends heart beat change head set unsend msg");
                                    console.log(err);
                                }
                                complete++;
                                if (complete === fail_send_friends.length) {
                                    callback(null);
                                }
                            })
                        }
                    } else {
                        callback(null);
                    }
                }
            })
        }],
        set_expire: ['set_unsend_msg',(result, callback) => {
            console.log("set exipire");
            if (fail_send_friends.length !== 0) {
                redis_client.expire("id:" + id + "friendHeadChangeList:", 3600 * 24 * 30 + 10, (err) => {
                    if (err) {
                        console.log("heart beat change had set expire");
                        console.log(err);
                    }
                    callback(null);
                })
            }
            callback(null);
        }]
    },(err) => {
        console.log("change headpic end");
        if (fail_send_friends.length != 0 || err) {
            callback1(null, bitmap);
        } else {
            callback1(null, ~change_head);
        }
    })
}

function setChangeHeadpicRelay(id,headpic){
    let rsp_to_client=new protobuf.RspToClient();
    let relay =  new protobuf.ChangeHeadpic.RelayToFriend();
    relay.setId(id);
    relay.setHeadpic(headpic);
    rsp_to_client.setChangeHeadpicRelay(relay)
    return rsp_to_client;
}

//返回seen
function rspSeen(socket, id, callback1) {
    // console.log("being rspseen");
    const READ_MYSQL_ERR = 1;
    const DEL_MYSQL_ERR = 2;
    let bitmap = 0b11111111;
    async.waterfall([
        function (callback) {
            mysql_client.query("select sender from temp_seen where receiver=?", id, (err, results) => {
                if (err) {
                    console.log(err);
                    callback(READ_MYSQL_ERR);
                }
                else
                    callback(null, results);
            })
        },
        function (results, callback) {
            if (results.length === 0) {
                callback(null, false);
            }
            else {
                let rsp_to_client = new protobuf.RspToClient();
                let send_rsp = new protobuf.Seen.ServerToB();
                for (let i = 0; i < results.length; i++) {
                    let id = results[i].sender;
                    let time = results[i].time;
                    let info = new protobuf.Seen.ServerToB.SeenInfo();
                    info.setSrcId(id);
                    info.setTime(time);
                    send_rsp.addSeenInfo(info);
                }
                rsp_to_client.setSeenServerToB(send_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rspSeen len:${rsp_buf.length}`);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf, (err) => {
                    if (err) {
                        console.log(err);
                        callback(null, false);
                    }
                    else {
                        callback(null, true);
                    }
                });
            }
        },
        function (send, callback) {
            if (send) {
                mysql_client.query("delete from temp_seen " +
                    "where receiver=?", id, (err) => {
                        if (err) {
                            console.log(err);
                            callback(DEL_MYSQL_ERR);
                        }
                        else {
                            callback(null, send);
                        }
                    })
            }
            else {
                callback(null, send);
            }
        }
    ], function (err, send) {
        if (err || !send) {
            callback1(null, bitmap);
        } else {
            callback1(null, ~seen);
        }
        // console.log("temp seen end");
    });
}

//返回被删除
function rspDelFriend(socket, id, callback1) {
    //1、根据id在temp_del_friend里面找，看自己是不是受害者。返回凶手们的id.
    //2、发送凶手们的id。
    //3、发送成功，删除temp
    // console.log("begin del friend");
    const READ_MYSQL_ERR = 1;
    const DEL_MYSQL_ERR = 2;
    const SEND_ERR = 3;
    let bitmap = 0b11111111;
    async.waterfall([
        function (callback) {
            mysql_client.query("select sender from temp_del_friend where receiver=?", id, (err, results) => {
                if (err) {
                    console.log(err);
                    callback(READ_MYSQL_ERR);
                }
                else {
                    // console.log("rspDelFriend mysql results");
                    callback(null, results);

                }
            })
        },
        function (results, callback) {
            if (results.length === 0) {
                callback(READ_MYSQL_ERR);
            }
            else {
                let rsp_to_client = new protobuf.RspToClient();
                let del_rsp = new protobuf.DeleteFriend.ServerToB();
                for (let i = 0; i < results.length; i++) {
                    let id = results[i].sender;
                    del_rsp.addSrcId(id);
                }
                // console.log(del_rsp);
                rsp_to_client.setDeleteFriendServerToB(del_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rspDel len:${rsp_buf.length}`);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf, (err) => {
                    if (err) {
                        console.log(err);
                        callback(SEND_ERR);
                    }
                    else {
                        callback(null);
                    }
                });
            }
        },
        function (callback) {
            mysql_client.query("delete from temp_del_friend " +
                "where receiver=?", id, (err) => {
                    if (err) {
                        console.log(err);
                        callback(DEL_MYSQL_ERR);
                    }
                    else {
                        callback(null);
                    }
                })
        }
    ], function (err, result) {
        if (err) {
            callback1(null, bitmap)
        }
        else {
            callback1(null, ~del_friend);
        }
        // console.log("del friend end");
    });
}
//返回temp聊天记录。
function rspUnreceivedMsg(socket, id, callback1) {
    //1、根据id从temp_record里面找到未发送的聊天记录。设置has_unsend.
    //2、发送。
    //3、发送成功？删除。发送失败，那算了。
    //4、结束
    // console.log("begin unreceived msg");
    let temp_ids = [];
    let has_unsend = false;
    let send = false;
    let bitmap = 0b11111111;
    const DEL_MYSQL_ERR = 1;
    const READ_MYSQL_ERR = 2;
    const SEND_ERR = 3;
    async.waterfall([
        function (callback) {
            mysql_client.query(
                "select chat_record_id,sender,time,content " +
                "from chat_record,temp_chat_record " +
                "where " +
                "receiver=? and " +
                "chat_record_id = temp_chat_record_id", id, (err, results) => {
                    if (err) {
                        console.log(err);
                        callback(READ_MYSQL_ERR);
                    }
                    else
                        callback(null, results);
                });
        },
        function (results, callback) {
            if (!results || results.length == 0) {
                callback(READ_MYSQL_ERR);

            }
            else {
                let rsp_to_client = new protobuf.RspToClient();
                let unreceived_msg_res = new protobuf.UnreceivedMsg.Res();
                let len = results.length;
                for (let i = 0; i < len; i++) {
                    let info = results[i];
                    let msg = new protobuf.UnreceivedMsg.Res.Msg();
                    msg.setOtherId(info.sender);
                    msg.setContent(info.content);
                    msg.setTime(info.time);
                    unreceived_msg_res.addMsg(msg);
                    temp_ids.push(info.chat_record_id);
                }
                // console.log(unreceived_msg_res);
                rsp_to_client.setUnreceivedMsgRes(unreceived_msg_res);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rspUnreceivemsg len:${rsp_buf.length}`);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf, (err) => {
                    if (err) {
                        console.log(err);
                        callback(SEND_ERR);
                    }
                    else {
                        callback(null);

                    }
                });
            }
        },
        function (callback) {

            mysql_client.beginTransaction((err) => {
                if (err) {
                    console.log(err);
                    callback(DEL_MYSQL_ERR);
                } else {
                    mysql_client.query("delete from temp_chat_record " +
                        "where temp_chat_record_id in (?)", [temp_ids], (err, res) => {
                            if (err) {
                                callback(DEL_MYSQL_ERR);
                            } else {
                                mysql_client.commit((err) => {
                                    if (err) {
                                        callback(DEL_MYSQL_ERR);
                                        return mysql_client.rollback(() => {
                                            console.log(err);
                                        })
                                    }
                                    else {
                                        callback(null);
                                    }
                                });
                            }
                        });
                }
            });

        }
    ], function (err, result) {
        //TODO 处理删除temp失败
        if (err) {
            console.log("unreceived msg err");
            console.log(err);

            callback1(null, bitmap);
        }
        else {
            console.log("unreceived msg succ");
            console.log((~unsend_msg) >>> 0);
            callback1(null, ~unsend_msg);
        }
        // console.log("unreceived msg end");
    });
}


//返回心跳确认。
function rspHeartBeat(socket) {
    let rsp_to_client = new protobuf.RspToClient();
    let heart_beat_res = new protobuf.HeartBeat.Res();
    heart_beat_res.setAlive(true);
    rsp_to_client.setHeartBeatRes(heart_beat_res);
    rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
    // console.log(`rsp_buf len:${rsp_buf.length}`);

    socket.write(rsp_buf, (err) => {
        //心跳发送失败。
        if (err) {
            console.log(err);
            console.log("error:heartbeat send fail");
        }
        else{
            console.log('send alive');
        }
        // console.log("heartbeat end");
    });
}

//从temp表中返回addfriend相关信息。
function rspAddfriendFromSelf(socket, id, callback1) {
    // console.log("begin rspAddfriendFromSelf");
    let rsp_ids = [];
    let bitmap = 0b11111111;
    const DEL_MYSQL_ERR = 1;
    const READ_MYSQL_ERR = 2;
    const SEND_ERR = 3;
    async.waterfall([
        function (callback) {
            mysql_client.query(
                'select id,name,headpic,state,rsp_id ' +
                'from userinfo,temp_response_to_add_friend,request_for_add_friend ' +
                'where ' +
                'id_which_request_from = ? and ' +
                'id_which_request_to = id and ' +
                'rsp_id=request_id', id, (err, results, fields) => {
                    if (err) {
                        console.log(err);
                        callback(READ_MYSQL_ERR);
                    } else {
                        // console.log("get temp add from self mysql res");
                        callback(null, results);
                    }
                });
        },
        function (results, callback) {
            if (results === null || results.length === 0) {
                callback(READ_MYSQL_ERR);
            }
            else {
                let rsp_to_client = new protobuf.RspToClient();
                let add_rsp = new protobuf.AddFriendFromSelf.Rsp();
                for (let i = 0; i < results.length; i++) {
                    let req_from_other = new protobuf.AddFriendFromSelf.Rsp.RequestFromSelf();
                    let info = results[i];
                    let obj = new protobuf.People();
                    obj.setName(info.name);
                    obj.setId(info.id);
                    obj.setHeadpic(info.headpic);
                    req_from_other.setObjUser(obj);
                    req_from_other.setStatus(info.state);
                    add_rsp.addRequests(req_from_other);
                    rsp_ids.push(info.rsp_id);
                }
                rsp_to_client.setAddFriendFromSelfRsp(add_rsp);
                // console.log(`rspAddfriendFromSelf len:${rsp_to_client.length}`);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rspAddfriendFromSelf len:${rsp_buf.length}`);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf, function (err) {
                    if (err) {
                        console.log(err);
                        callback(SEND_ERR);
                    }
                    else {
                        callback(null);
                    }
                });
            }
        },

        function (callback) {
            mysql_client.query("delete from temp_response_to_add_friend where rsp_id in (?)", [rsp_ids], (err, res) => {
                if (err) {
                    console.log(err);
                    callback(DEL_MYSQL_ERR);
                }
                else
                    callback(null);
            })
        },
    ], function (err, result) {
        if (err) {
            console.log(err);
            callback1(null, bitmap);
        }
        else {
            callback1(null, ~addfriendfromself);
        }
    });
}
function rspAddfriendFromOther(socket, id, callback1) {
    // console.log("begin rspAddfriendFromOther");
    let unsend_request_ids = [];
    let bitmap = 0b11111111;
    const DEL_MYSQL_ERR = 1;
    const READ_MYSQL_ERR = 2;
    const SEND_ERR = 3;
    async.waterfall([
        function (callback) {
            //只取出还在等待我回应的人。state=00
            mysql_client.query(
                'select id,name,headpic,unsend_request_id from userinfo,temp_request_for_add_friend,request_for_add_friend where ' +
                'id_which_request_from = id and id_which_request_to = ? and unsend_request_id=request_id and state=0x00', id, (err, results, fields) => {
                    if (err) {
                        console.log(err);
                        callback(READ_MYSQL_ERR);
                    }
                    else
                        callback(null, results);
                });
        },
        function (results, callback) {
            if (results === null || results.length == 0) {
                callback(READ_MYSQL_ERR);
            }
            else {
                let rsp_to_client = new protobuf.RspToClient();
                let add_rsp = new protobuf.AddFriendFromOther.Rsp();
                for (let i = 0; i < results.length; i++) {
                    // let req_from_other=new protobuf.AddFriendFromOther.Rsp.RequestFromSelf();
                    let info = results[i];
                    let obj = new protobuf.People();
                    obj.setName(info.name);
                    obj.setId(info.id);
                    obj.setHeadpic(info.headpic);
                    add_rsp.addUser(obj);
                    unsend_request_ids.push(info.unsend_request_id);
                }
                rsp_to_client.setAddFriendFromOtherRsp(add_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rspAddfriendFromOther len:${rsp_buf.length}`);

                // console.log(`rsp_buf len:${rsp_buf.length}`);
                socket.write(rsp_buf, function (err) {
                    if (err) {
                        console.log(err);
                        callback(SEND_ERR);
                    }
                    else
                        callback(null);
                });
            }
        },

        function (callback) {
            mysql_client.query("delete from temp_request_for_add_friend where unsend_request_id in (?)", [unsend_request_ids], (err, res) => {
                if (err) {
                    console.log(err);
                    callback(DEL_MYSQL_ERR);
                }
                else
                    callback(null);
            })
        },
    ], function (err, results) {
        if (err) {
            console.log(err);
            callback1(null, bitmap);
        }
        else {
            callback1(null, ~addfriendfromother);
        }
        // console.log("temp add from other end");
    });
}


module.exports = dealHeartBeatReq;