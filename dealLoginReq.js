const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const redis=require("redis");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealLoginReq(socket_id,socket,req_to_server,redis_client,mysql_client){
    let login_req=req_to_server.getLoginReq();
    let id=login_req.getId();
    let password=login_req.getPassword();
    let in_ip=login_req.getInIp();
    let in_port=login_req.getInPort();
    // let time = (new Date()).getTime();
    console.log("login start");
	async.auto({
        verify_user:function (callback){
            console.log("verify_userrrrrrrrrrrr");
            mysql_client.query('select id,password from userinfo where id = ?',id,(err,results,fields)=>{
                if(!err && results.length!==0 && results[0].password===password){
                    callback(null);
                }else{
                    if(err){
                        console.log(err);
                        callback(err_types.UNKNOWN_LOGIN_ERR+1);//TODO 需要注释1的作用
                    }else if(results.length===0){
                        console.log("results.length:"+results.length);
                        callback(err_types.USER_NO_EXIST+1)
                    }else{
                        console.log("passwordfail:id:"+id+'password:'+password);
                        callback(err_types.ID_OR_PSW_WRONG+1);
                    }
                }
            });
            },
        get_self_info:['verify_user',function (result,callback){
            console.log("get_self_infoooooooooooooooooooooooooooooo");
            mysql_client.query('select name,headpic from userinfo where id = ?',id,(err,results,fields)=>{
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_LOGIN_ERR+1)
                }else{
                    callback(null,{name:results[0].name,headpic:results[0].headpic});
                }
            });
            }],
/*
        get_friend_info:['verify_user',function(result,callback){
            console.log("get_friend_infooooooooooooooooooooooo");
            mysql_client.query(
                'select id,name,headpic from userinfo,friends where id1 = ? and id = id2 union '+
                'select id,name,headpic from userinfo,friends where id2 = ? and id = id1',[id,id],(err,results,fields)=>{
                    if(err){
                        console.log(err);
                        callback(err_types.UNKNOWN_LOGIN_ERR+1);
                    }else{
                        callback(null,results);
                    }
                    

                });
            }],*/
/*        get_chat_record:['verify_user',function(res,callback){
            console.log("get chat record~~~~~");
            mysql_client.query('select sender,time,content from chat_record,temp_chat_record '
            +'where chat_record_id=temp_chat_record_id and receiver=?',id,(err,results,field)=>{
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_LOGIN_ERR+1)
                }else{
                    callback(null,results);
                }
            })
        }],*/
        // get_request_from_other:['verify_user',function(result,callback){
        //     console.log("get request from otherrrrrrrrrrrrrrrrrrrrrrrrrrrr");
        //     mysql_client.query(
        //         'select id,name,headpic from request_for_add_friend,userinfo where '+
        //         'id_which_request_to = ? and state = ? and request_time_ms + 3600*24*7*1000 > ? and '+
        //         'id_which_request_from = id ',[id,0b00,time],(err,results,fields)=>{
        //             if(err){
        //                 console.log(err);
        //                 callback(err_types.UNKNOWN_LOGIN_ERR+1);
        //             }else{
        //                 callback(null,results);
        //             }

        //         }
        //     )
        //     }],
        // get_request_from_self:['verify_user',function(result,callback){
        //     console.log("get_request_from_selfffffffffffffffffffffffffffffff");
        //     mysql_client.query(
        //         'select id,name,headpic,state from userinfo,request_for_add_friend where '+
        //         'id_which_request_from = ? and id_which_request_to = id and request_time_ms + 3600*24*7*1000 > ? and '+
        //         'state in (?,?)',[id,time,0b00,0b11],(err,results,fields)=>{
        //             if(err){
        //                 console.log(err);
        //                 callback(err_types.UNKNOWN_LOGIN_ERR+1);
        //             }else{
        //                 callback(null,results);
        //             }
        //         })
        //     }],
        get_token:['verify_user',function(result,callback){
            console.log("gettokennnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn");
            short_token = utils.generate_short_token(id,password);
            long_token = utils.generate_long_token(id,password);
            callback(null,{"short_token":short_token,"long_token":long_token});
            }],
        set_redis:['get_self_info','get_request_from_other','get_request_from_self','get_token',function(results,callback){
            console.log("set_redisssssssssssssssssssssssssssssssssss");
            redis_client.setex("short_token:"+results.get_token.short_token,3600+10,id,redis.print);
            redis_client.setex("long_token:"+results.get_token.long_token,3600*24*30+10,id,redis.print);
            console.log("socket add:"+socket.remoteAddress);
            redis_client.setex("id:"+id,130,JSON.stringify({
                                                        "in_ip":in_ip,
                                                        "in_port":in_port,
                                                        "out_ip":utils.ip_str_to_num(socket.remoteAddress),
                                                        "out_port":socket.remotePort}),redis.print);
            redis_client.setex("id:"+id+"socket:",130,socket_id,redis.print);
            
            redis_client.setex('id:'+id+'pwd:',3600*24+10,password,redis.print);
            callback(null);
            //TODO redis set失败的处理
        }]},function(err,results){
            console.log("finallllllllllllllllllllllllllllllllllllll");
            if(err){
                console.log("errorrrrrrrrrrrrrrrrrrrrrrrrrr"+err);
                sendError(socket,err-1);

            }else{
                let rsp_buf;
                let rsp_to_client=new protobuf.RspToClient();
                let login_res = new protobuf.Login.Res();
                login_res.setName(results.get_self_info.name);
                login_res.setHeadpic(results.get_self_info.headpic);

                // for(request in results.get_request_from_other.results){
                //     let user_wait_for_add = new protobuf.People();
                //     user_wait_for_add.setId(request.id);
                //     user_wait_for_add.setName(request.name);
                //     user_wait_for_add.setHeadpic(request.headpic);
                //     login_res.addUsersWaitForAdd(user_wait_for_add);
                // }
                // for(request in results.get_request_from_self.results){
                //     let user_hope_to_add = new protobuf.Login.Res.RequestFromSelf();
                //     let user_info = new protobuf.People();
                //     user_info.setId(request.id);
                //     user_info.setName(request.name);
                //     user_info.setHeadpic(request.headpic);
                //     user_hope_to_add.setObjUser(user_info);
                //     user_hope_to_add.setRefuse((request.state.readUInt8()===0)?false:true);
                //     login_res.addAddFriendReq(user_hope_to_add);
                // }
                login_res.setShortToken(results.get_token.short_token);
                login_res.setLongToken(results.get_token.long_token);
                // login_res.setStartTime(time);
                rsp_to_client.setLoginRes(login_res);

                ///////好友列表//////
/*                let friend_list=new protobuf.FriendList.Rsp();
                for(friend_info in results.get_friend_info){
                    let friend = new protobuf.People();
                    friend.setId(friend_info.id);
                    friend.setName(friend_info.name);
                    friend.setHeadpic(friend_info.headpic);
                    friend_list.addFriendList(friend);
                }
                rsp_to_client.setFriendlistRes(friend_list);
*/
                /////聊天记录/////
/*                let chat_record_res=new protobuf.ChatRecord.Res();
                for(result in results.get_chat_record){
                    let msg=new protobuf.ChatRecord.Res.Msg();
                    msg.setOtherId(result.sender);
                    msg.setContent(result.content);
                    msg.setTime(result.time);
                    chat_record_res.addMsg(msg);
                }
                rsp_to_client.setChatRecordRes(chat_record_res);
*/

                /////发送//////
                rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                socket.write(rsp_buf);
            }

        });
        console.log("login end");
}

module.exports=dealLoginReq;