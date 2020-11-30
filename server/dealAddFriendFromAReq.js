const async = require("async");
const protobuf = require("./test_pb");
const utils = require("./utils");
const sendError = require("./dealError");
const err_types = protobuf.Error.Error_type;
function dealAddFriendFromAReq(socket, req_to_server, redis_client, mysql_client, long_term_Socks) {
    console.log("begin dealAddFriendFromAReq");
    let search_user_req = req_to_server.getAddFriendAToServer();
    let A_short_token = search_user_req.getAShortToken();
    let B_id = search_user_req.getBId();
    console.log("BID:" + B_id);
    //TODO 现在加好友请求永远不会过期了。暂时不删除数据库中的request_time项。
    //暂时置为0.
    let A_time = 0;
    let A_id;
    let B_socket;
    let no_send_to_B = true;
    const exist_request = 1;
    let affected_request_id;
    let send_from_other = true;
    console.log("deal A add friend start");
    async.auto({
        check_A_short_token: function (callback) {
            redis_client.get("short_token:" + A_short_token, (err, reply) => {
                if (err) {
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN);
                } else {
                    A_id = reply;
                    console.log("AID:" + A_id);
                    callback(null);
                }
            })
        },
        check_friends: ["check_A_short_token",function(results,callback){
            mysql_client.query(
                "select * from friends where (id1=? and id2=?) or (id2=? and id1=?)",
                [A_id,B_id,A_id,B_id],(err,res)=>{
                    if(err || (res && res.length)){
                        console.log(err);
                        console.log(res);
                        callback(err_types.UNKNOWN_ADD_ERR);
                    }
                    else{
                        callback(null);
                    }
                }
            )
        }],
        check_exist_valid_A_to_B_request: ["check_A_short_token", function (results, callback) {
            mysql_client.query(
                'select request_id from request_for_add_friend where id_which_request_from = ? ' +
                'and id_which_request_to = ? and state = 0x00',
                [A_id, B_id], (err, res) => {
                    if (err) {
                        console.log(err);
                        callback(err_types.UNKNOWN_ADD_ERR);
                    }
                    else if (res && res.length != 0) {
                        //已经存在请求。
                        console.log("add req already exist");
                        // console.log(res);
                        affected_request_id=Number(res[0].length);
                        callback(null, exist_request);
                    }
                    else {
                        console.log("ready to insert valid request");
                        // affected_request_id=Number(res);
                        callback(null, !exist_request);
                    }
                })
        }],
        insert_mysql_with_request: ['check_exist_valid_A_to_B_request','check_friends', function (results, callback) {
            if (results.check_exist_valid_A_to_B_request === exist_request) {
                console.log(exist_request);
                callback(null);
            } else {
                console.log("insert into request_for_add_friend");
                mysql_client.query(
                    'insert into request_for_add_friend ' +
                    '(id_which_request_from,id_which_request_to,state,request_time_ms) ' +
                    'values(?,?,0x00,0)', [A_id, B_id], (err, res) => {
                        if (err) {
                            console.log(err);
                            callback(err_types.UNKNOWN_ADD_ERR);
                        } else {
                            affected_request_id = res.insertId;
                            callback(null);
                        }
                    })
            }
        }],
        check_B_online: ['check_A_short_token', function (results, callback) {
            redis_client.get("id:" + B_id + "socket:", (err, reply) => {
                if (err || reply === null || !long_term_Socks[reply] || long_term_Socks[reply].destroyed === true) {
                    //B不在线
                    no_send_to_B = true;
                    callback(null);
                } else {
                    no_send_to_B = false;
                    B_socket = long_term_Socks[reply];
                    callback(null);
                }
            });
        }],
        get_A_info: ["check_B_online", function (results, callback) {
            if (no_send_to_B == false) {
                mysql_client.query('select name,headpic from userinfo where id = ?', A_id, (err, sql_results) => {
                    if (err || results.length === 0) {
                        no_send_to_B = true;
                        callback(null);
                    } else {
                        callback(null, sql_results);
                    }
                })
            } else {
                callback(null);
            }
        }],
        send_to_B: ['insert_mysql_with_request', "get_A_info", function (results, callback) {
            if (no_send_to_B !== true) {
                console.log("send!");
                let rsp_to_client = new protobuf.RspToClient();
                let add_rsp = new protobuf.AddFriendFromOther.Rsp();
                for (let i = 0; i < results.get_A_info.length; i++) {
                    // let req_from_other=new protobuf.AddFriendFromOther.Rsp.RequestFromSelf();
                    let info = results.get_A_info[i];
                    let obj = new protobuf.People();
                    obj.setName(info.name);
                    obj.setId(A_id);
                    obj.setHeadpic(info.headpic);
                    add_rsp.addUser(obj);
                    // unsend_request_ids.push(info.request_id);
                }
                rsp_to_client.setAddFriendFromOtherRsp(add_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                console.log(`rsp_buf len:${rsp_buf.length}`);
                B_socket.write(rsp_buf, function (err) {
                    if (err) {
                        console.log(err);
                    }
                    send_from_other = err ? false : true;
                    callback(null);
                });
            }
            else {
                callback(null);
            }
        }],
        set_temp: ["send_to_B", function (results, callback) {
            if (!send_from_other || no_send_to_B) {
                //暂存到temp 里面
                console.log("no send or send fail");
                console.log(affected_request_id);
                mysql_client.query(
                    "insert into temp_request_for_add_friend values(?)",
                    [affected_request_id], (err) => {
                        if (err)
                            console.log(err);
                        callback(null);
                    });
            }
            else {
                callback(null);
            }
        }],

        set_redis: ["send_to_B", function (res, callback) {
            if (!send_from_other || no_send_to_B) {
                redis_client.get("id:" + B_id + "bitmap:", (err, reply) => {
                    let bitmap = Number(reply);
                    let new_bitmap = bitmap | 0b00100000;
                    redis_client.setex("id:" + B_id + "bitmap:", 3600 * 24 * 30 + 10, new_bitmap, () => {
                        callback(null);
                    });
                })
            }
            else{
                callback(null);
            }
        }]

    }, function (err, results) {
        if (err) {
            sendError(socket, err);
        }
        console.log("dealAddFriendFromAReq end");
    })
}

module.exports = dealAddFriendFromAReq;