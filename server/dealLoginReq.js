const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const md5 = require('md5-node');
const redis=require("redis");
const err_types=protobuf.Error.Error_type;
let mysql_client;
let redis_client;
function dealLoginReq(socket,req_to_server,redis,mysql){
    mysql_client=mysql;
    redis_client=redis;
    let login_req=req_to_server.getLoginReq();
    let id=login_req.getId();
    let password=login_req.getPassword();
    let in_ip=login_req.getInIp();
    let in_port=login_req.getInPort();
    console.log("login start");
	async.auto({
        verify_user:function (callback){
            // console.log("verify_userrrrrrrrrrrr");
            mysql_client.query('select id,password from userinfo where id = ?',id,(err,results,fields)=>{
                if(!err && results.length!==0 && md5(id+results[0].password)===password){
                    // redis_client.get("id:"+id,(err,reply)=>{
                    //     if(err||reply===null){
                    //         callback(null)
                    //     }else{
                    //         callback(err_types.UNKNOWN_LOGIN_ERR+1);
                    //     }
                    // })
                    callback(null);
                }else{
                    // console.log(id);
                    // console.log(password);
                    // console.log(results[0].password);
                    // console.log( md5(id+results[0].password));
                    // console.log(md5(id+password));
                    if(err){
                        console.log(err);
                        callback(err_types.UNKNOWN_LOGIN_ERR+1);//TODO 需要注释1的作用
                    }else if(results.length===0){
                        // console.log("results.length:"+results.length);
                        callback(err_types.USER_NO_EXIST+1)
                    }else{
                        console.log("passwordfail:id:"+id+'password:'+password);
                        callback(err_types.ID_OR_PSW_WRONG+1);
                    }
                }
            });
            },
        get_self_info:['verify_user',function (result,callback){
            // console.log("get_self_infoooooooooooooooooooooooooooooo");
            mysql_client.query('select name,headpic from userinfo where id = ?',id,(err,results,fields)=>{
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_LOGIN_ERR+1)
                }else{
                    callback(null,{name:results[0].name,headpic:results[0].headpic});
                }
            });
            }],
            
        get_token:['verify_user',function(result,callback){
            // console.log("gettokennnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn");
            short_token = utils.generate_short_token(id,password);
            long_token = utils.generate_long_token(id,password);
            callback(null,{"short_token":short_token,"long_token":long_token});
            }],




        set_redis:['get_self_info',
                    'get_token',
            function(results,callback){
            // console.log("set_redisssssssssssssssssssssssssssssssssss");
            redis_client.setex("short_token:"+results.get_token.short_token,3600*24+10,id,redis.print);
            redis_client.setex("long_token:"+results.get_token.long_token,3600*24*30+10,id,redis.print);
            //console.log("socket add:"+socket.remoteAddress);
            redis_client.setex("id:"+id,130,JSON.stringify({
                                                        "in_ip":in_ip,
                                                        "in_port":in_port,
                                                        "out_ip":utils.ip_str_to_num(socket.remoteAddress),
                                                        "out_port":socket.remotePort}),redis.print);
            //redis_client.setex("id:"+id+"socket:",130,socket_id,redis.print);
            //这个是静态的token，我们不需要保存。
            redis_client.setex('id:'+id+'pwd:',3600*24+10,password,redis.print);

            //位图!!!!!!!每次登录的时候设置.
            let bitmap=0b00000000;
            redis_client.setex("id:"+id+"bitmap:",3600*24*30+10,bitmap,(err)=>{
                if(!err){
                    console.log("setex bitmap ok");
                }
                else{
                    console.log(err);
                }
            });

            callback(null);


        }]},function(err,results){
            // console.log("finallllllllllllllllllllllllllllllllllllll");
            if(err){
                console.log("errorrrrrrrrrrrrrrrrrrrrrrrrrr"+err);
                sendError(socket,err-1);

            }
            else{
                //先发送正儿八经的登录成功的res
                let rsp_buf;
                let rsp_to_client=new protobuf.RspToClient();
                let login_res = new protobuf.Login.Res();
                login_res.setName(results.get_self_info.name);
                login_res.setHeadpic(results.get_self_info.headpic);
                login_res.setShortToken(results.get_token.short_token);
                login_res.setLongToken(results.get_token.long_token);
                rsp_to_client.setLoginRes(login_res);
                rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                socket.write(rsp_buf,(err)={
                    if(err){
                        console.log("error:login");
                        console.log(err);
                    }
                });

                //然后，发送各种暂存信息。
                //12
                rspAllAddfriendFromSelf(socket,id);
                //13
                rspAllAddfriendFromOther(socket,id);
                //14
                rspUnreceivedMsg(socket,id);
                //18
                rspDelFriend(socket,id);
                //19
                rspSeen(socket,id);
                //9
                rspFriendlist(socket,id);
            }

        });
        console.log("login end");
}

//返回friendlist
function rspFriendlist(socket,id){
    // console.log("begin rspFriendlist");
    async.waterfall([
        function(callback){
            mysql_client.query(
                'select id,name,headpic from userinfo,friends where id1 = ? and id = id2 union '+
                'select id,name,headpic from userinfo,friends where id2 = ? and id = id1',[id,id],(err,sql_results)=>{
                    if(err){
                        callback(err_types.UNKNOWN_FRIEND_ERR);
                    }else{
                        // console.log("results length:"+sql_results.length);
                        // console.log(sql_results);
                        callback(null,sql_results);

                    }
                })
        },
        
        function(results,callback){
            let command=[];
            command.push("id:"+id+"friendlist:");
            command.push("100");
            if(results && results.length){

                for(let i=0;i<results.length;i++){
                    let friend=results[i];
                    command.push(friend.id);
                }

            }
            redis_client.del("id:"+id+"friendlist:",(err)=>{
                redis_client.send_command('lpush',command,(err)=>{
                    if(!err){
                        console.log("lpush friendlist ok");
                    }
                    else{
                        console.log(err);
                    }
                });     
                redis_client.expire("id:"+id+"friendlist:",3600 * 24 * 30 + 10,(err)=>{
                    if(!err){
                        console.log("setex friendlist ok");
                    }
                    else{
                        console.log(err);
                    }
                });           
            })
            callback(null,results);
        }

    ],function(err,results){
            if(err){
                console.log("there are some err");
                sendError(socket,err);
            }else{
                let rsp_to_client=new protobuf.RspToClient();
                let frindlist_rsp = new protobuf.FriendList.Rsp();
                for(var i = 0;i<results.length;i++){
                    // console.log("friend_infoffffffffffffffff");
                    let friend_info = results[i];
                    let friend = new protobuf.People();
                    friend.setId(friend_info.id);
                    friend.setName(friend_info.name);
                    friend.setHeadpic(friend_info.headpic);
                    frindlist_rsp.addFriendList(friend);
                    // console.log(frindlist_rsp);
                }
                rsp_to_client.setFriendlistRes(frindlist_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                socket.write(rsp_buf,(err)=>{
                    if(err){
                        console.log(err);
                    }
                    // console.log("rspFriendlist end");
                });
            }
        })
}

//返回seen
function rspSeen(socket,id){
    // console.log("being rspseen");
    const READ_MYSQL_ERR=1;
    const DEL_MYSQL_ERR=2;
    async.waterfall([
        function(callback){
            mysql_client.query("select sender from temp_seen where receiver=?",id,(err,results)=>{
                if(err){
                    console.log(err);
                    callback(READ_MYSQL_ERR);
                }
                else
                    callback(null,results);
            })
        },
        function(results,callback){
            if(results.length===0){
                callback(null,false);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();
                let send_rsp=new protobuf.Seen.ServerToB();
                for(let i=0;i<results.length;i++){
                    let id=results[i].sender;
                    let time=results[i].time;
                    let info=new protobuf.Seen.ServerToB.SeenInfo();
                    info.setSrcId(id);
                    info.setTime(time);
                    send_rsp.addSeenInfo(info);
                }
                rsp_to_client.setSeenServerToB(send_rsp);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf,(err)=>{
                    if(err){
                        console.log(err);
                        callback(null,false);
                    }
                    else{
                        callback(null,true);
                    }
                });
            }
        },
        function(send,callback){
            if(send){
                mysql_client.query("delete from temp_seen "+
                "where receiver=?",id,(err)=>{
                    if(err){
                        console.log(err);
                        callback(DEL_MYSQL_ERR);
                    }
                    else{
                        callback(null);
                    }
                })
            }
            else{
                callback(null);
            }
        }
    ],function(err,result){
        if(err==DEL_MYSQL_ERR){
            //TODO delete error
            console.log("del temp seen err");
        }
        // console.log("temp seen end");
    });
}

//返回被删除
function rspDelFriend(socket,id){
    //1、根据id在temp_del_friend里面找，看自己是不是受害者。返回凶手们的id.
    //2、发送凶手们的id。
    //3、发送成功，删除temp
    // console.log("begin del friend");
    const READ_MYSQL_ERR=1;
    const DEL_MYSQL_ERR=2;
    async.waterfall([
        function(callback){
            mysql_client.query("select sender from temp_del_friend where receiver=?",id,(err,results)=>{
                if(err){
                    console.log(err);
                    callback(READ_MYSQL_ERR);
                }
                else{
                    // console.log("rspDelFriend mysql results");
                    callback(null,results);

                }
            })
        },
        function(results,callback){
            if(results.length===0){
                callback(null,false);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();
                let del_rsp=new protobuf.DeleteFriend.ServerToB();
                for(let i=0;i<results.length;i++){
                    let id=results[i].sender;
                    del_rsp.addSrcId(id);
                }
                // console.log(del_rsp);
                rsp_to_client.setDeleteFriendServerToB(del_rsp);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf,(err)=>{
                    if(err){
                        console.log(err);
                        callback(null,false);
                    }
                    else{
                        callback(null,true);
                    }
                });
            }
        },
        function(send,callback){
            if(send){
                mysql_client.query("delete from temp_del_friend "+
                "where receiver=?",id,(err)=>{
                    if(err){
                        console.log(err);
                        callback(DEL_MYSQL_ERR);
                    }
                    else{
                        callback(null);
                    }
                })
            }
            else{
                callback(null);
            }
        }
    ],function(err,result){
        if(err==DEL_MYSQL_ERR){
            //TODO delete error
            console.log("del temp_del_friend err");
        }
        // console.log("del friend end");
    });
}

//返回temp聊天记录。
function rspUnreceivedMsg(socket,id){
    //1、根据id从temp_record里面找到未发送的聊天记录。设置has_unsend.
    //2、发送。
    //3、发送成功？删除。发送失败，那算了。
    //4、结束
    // console.log("begin unreceived msg");
    let temp_ids=[];
    let has_unsend=false;
    let send=false;
    const DEL_MYSQL_ERR=1;
    const GET_UNRECEIVED_ERR = 2;
    async.waterfall([
        function(callback){
            mysql_client.query(
                "select chat_record_id,sender,time,content "+
                "from chat_record,temp_chat_record "+
                "where "+
                        "receiver=? and "+
                        "chat_record_id = temp_chat_record_id",id,(err,results)=>{
                if(err){
                    console.log(err);
                    callback(GET_UNRECEIVED_ERR)
                }
                if(results.length!=0){
                    has_unsend=true;
                    callback(null,results);
                }
            });
        },
        function(results,callback){
            if(!has_unsend){
                callback(null);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();
                let unreceived_msg_res=new protobuf.UnreceivedMsg.Res();
                let len = results.length;
                for(let i=0;i<len;i++){
                    let info=results[i];
                    let msg=new protobuf.UnreceivedMsg.Res.Msg();
                    msg.setOtherId(info.sender);
                    msg.setContent(info.content);
                    msg.setTime(info.time);
                    unreceived_msg_res.addMsg(msg);
                    temp_ids.push(info.chat_record_id);
                }
                // console.log(unreceived_msg_res);
                rsp_to_client.setUnreceivedMsgRes(unreceived_msg_res);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf,(err)=>{
                    if(err){
                        console.log(err);
                    }
                    send=err?false:true;
                    callback(null);
                });
            }
        },
        function(callback){
            if(!send || !has_unsend){
                callback(null);
            }
            else{
                mysql_client.query("delete from temp_chat_record "+
                "where temp_chat_record_id in (?)",[temp_ids],(err)=>{
                    if(err){
                        callback(DEL_MYSQL_ERR);
                    }else{
                        callback(null);
                    }
                })
            }
        }
    ],function(err,result){
        //TODO 处理删除temp失败
        if(err===DEL_MYSQL_ERR){
            console.log("error:delete unsend message fail");
        }else if(err===GET_UNRECEIVED_ERR){
            console.log("get unreceive msg fail");
        }
        // console.log("unreceived msg end");
    });
}


//从temp表中返回addfriend相关信息。
function rspAllAddfriendFromSelf(socket,id){
    // console.log("rspAllAddfriendFromSelf");
    let send_from_self=false;
    let rsp_ids=[];
    let del_temp_rsp_fail=false;
    let find_from_mysql_err = 1;
    async.waterfall([
        function(callback){
            mysql_client.query(
                "select id,name,headpic,state,request_id "+
                "from request_for_add_friend, userinfo "+
                "where id_which_request_from = ? and "+
                "id_which_request_to = id",id,(err,results,fields)=>{
                    if(err){
                        console.log(err);
                        callback(find_from_mysql_err);
                    }else{
                        // console.log("mysql_res:");
                        // console.log(results);
                        callback(null,results);
                    }
            });     
        },
        function(results,callback){
            if(results===null || results.length===0){
                callback(null);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();
                let add_rsp=new protobuf.AddFriendFromSelf.Rsp();
                for(let i=0;i<results.length;i++){
                    let req_from_other=new protobuf.AddFriendFromSelf.Rsp.RequestFromSelf();
                    let info=results[i];
                    let obj=new protobuf.People();
                    obj.setName(info.name);
                    obj.setId(info.id);
                    obj.setHeadpic(info.headpic);
                    req_from_other.setObjUser(obj);
                    req_from_other.setStatus(info.state);
                    add_rsp.addRequests(req_from_other);
                    rsp_ids.push(info.request_id);
                }
                rsp_to_client.setAddFriendFromSelfRsp(add_rsp);                
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);  
                // console.log(`rsp_buf len:${rsp_buf.length}`);

                socket.write(rsp_buf,function(err){
                    send_from_self=err?false:true;
                    callback(null);
                });
            }
        },

        function(callback){
            if(send_from_self){
                // console.log("begin delete from temp_response_to_add_friend");
                // console.log("rsp_ids:"+rsp_ids);
                mysql_client.query("delete from temp_response_to_add_friend where rsp_id in (?)",[rsp_ids],(err,res)=>{
                    if(err){
                        console.log(err);
                        del_temp_rsp_fail=true;                  
                    }
                    else{
                        // console.log("del temp_response_to_add_friend ok");
                    }
                    callback(null);
                })
            }
            else{
                callback(null);
            }
        },
    ],function(err,result){
        if(err){
            console.log("rspAllAddfriendFromSelf err");
            console.log(err);
        }
        //TODO 删除temp失败
        if(del_temp_rsp_fail){
            console.log("del temp rsp fail");
        }
        // console.log("rspAllAddfriendFromSelf end");
    });
}
function rspAllAddfriendFromOther(socket,id){
    // console.log("begin rspAllAddfriendFromOther");
    let send_from_other=false;
    let unsend_request_ids=[];
    let del_temp_req_fail=false;
    async.waterfall([
        function(callback){
            //只取出还在等待我回应的人。state=00
            mysql_client.query(
                "select id,name,headpic,request_id "+
                "from request_for_add_friend,userinfo "+
                "where id_which_request_from = id and "+
                "id_which_request_to = ? and "+
                "state = 0x00",id,(err,results)=>{
                    if(err){
                        console.log(err);
                    }
                    // console.log("rspAllAddfriendFromOther res:");
                    // console.log(results);
                    callback(null,results);
            });  
        },
        function(results,callback){
            if(results===null || results.length==0){
                callback(null);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();
                let add_rsp=new protobuf.AddFriendFromOther.Rsp();
                for(let i=0;i<results.length;i++){
                    // let req_from_other=new protobuf.AddFriendFromOther.Rsp.RequestFromSelf();
                    let info=results[i];
                    let obj=new protobuf.People();
                    obj.setName(info.name);
                    obj.setId(info.id);
                    obj.setHeadpic(info.headpic);
                    add_rsp.addUser(obj);
                    unsend_request_ids.push(info.request_id);
                }
                // console.log(add_rsp);
                rsp_to_client.setAddFriendFromOtherRsp(add_rsp);
                // console.log("rsp startttttttttttttttt:\n");
                // console.log(rsp_to_client);
                // rsp_to_client.serializeBinary();
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);  
                // console.log(`rsp_buf len:${rsp_buf.length}`);
                socket.write(rsp_buf,function(err){
                    send_from_other=err?false:true;
                    callback(null);
                });
            }
        },

        function(callback){
            if(send_from_other){
                mysql_client.query("delete from temp_request_for_add_friend where unsend_request_id in (?)",[unsend_request_ids],(err,res)=>{
                    if(err){
                        console.log(err);
                        del_temp_req_fail=true;
                    }
                    callback(null);
                })
            }
            else{
                callback(null);
            }
        },
    ],function(err,results){
        //TODO 删除temp失败
        if(send_from_other && del_temp_req_fail){
            console.log("cont del req fail");
        }
        // console.log("rspAllAddfriendFromOther end");
    });
}


module.exports=dealLoginReq;