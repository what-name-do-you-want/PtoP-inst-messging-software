const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealChangeName(socket,req_to_server,redis_client,mysql_client,long_term_sockets){
    console.log("begin dealChangeName");
    let change_name_req = req_to_server.getChangeNameReq();
    let short_token = change_name_req.getShortToken();
    let new_name = change_name_req.getNewName();
    let id;
    let friends;
    let fail_friends = [];
    async.auto({
        check_token:function (callback){ //checktoken
            console.log("check token");
            redis_client.get("short_token:"+short_token,function(err,reply){
                console.log("check token redis");
                if(err || !reply){
                    console.log(err);
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                }
                else{
                    id = parseInt(reply);
                    callback(null);
                }
            })
        },
        update_name:['check_token',(result,callback)=>{
            console.log("update name");
            mysql_client.query("update userinfo set name = ? where id =?",[new_name,id],(err,sql_result)=>{
                console.log("update name mysql client");
                if(err){
                    console.log(err);
                    console.log("in dealChangeName:set db fail");
                    let rsp=setChangeNameRsp(false);
                    let rsp_buf = utils.toBufferAndPrependLen(rsp);
                    socket.write(rsp_buf,(err)=>{
                        console.log(err);
                    });
                    //callback(err_types.UNKNOWN_CHANGE_ERR)
                    callback(err_types.UNKNOWN_CHANGE_ERR);
                }else{
                    let rsp=setChangeNameRsp(true);
                    let rsp_buf = utils.toBufferAndPrependLen(rsp);
                    socket.write(rsp_buf);
                    callback(null);
                }
            })
        }],
        get_friends:['update_name',(result,callback)=>{
            console.log("get_friends");
            redis_client.lrange("id:"+id+"friendlist:",0,-1,(err,reply)=>{
                console.log("get friends redis");
                if(err){
                    console.log("change name err with redis time:"+ (new Date()));
                    console.log(err);
                    callback(err_types.UNKNOWN_CHANGE_ERR);
                }else{
                    friends = reply;
                    console.log("id:"+id+":friendlist:");
                    callback(null);
                }

            })
        }],
        get_online_friends:['get_friends',(result,callback)=>{
            console.log("get_online friends");
            let all_complete = 0;
            for(let i=0;i<friends.length;i++){
                redis_client.get("id:"+friends[i]+"socket:",(err,reply)=>{
                    if(err){
                        console.log("there are some err check_online with id:"+id);
                        console.log(err);
                        fail_friends.push(friends[i]);
                        all_complete++;
                        if(all_complete===friends.length){
                            callback(null);
                        }
                    }else if(reply ===null){
                        fail_friends.push(friends[i]);
                        all_complete++;
                        if(all_complete===friends.length){
                            callback(null);
                        }
                    }else{
                        let friend_socket = long_term_sockets[parseInt(reply)];
                        if(friend_socket===undefined||friend_socket===null||friend_socket.destroyed){
                            fail_friends.push(friends[i]);
                            all_complete++;
                            if(all_complete===friends.length){

                                callback(null);
                            }
                        }else{
                            let relay = setChangeNameRelay(id,new_name);
                            let relay_buf = utils.toBufferAndPrependLen(relay);
                            friend_socket.write(relay_buf,(err)=>{
                                if(err){
                                    console.log(err);
                                    fail_friends.push(friends[i]);
                                }
                                all_complete++;
                                if(all_complete===friends.length){
                                    callback(null);
                                }
                            })
                        }
                    }

                })
            }
        }],
        set_fail_friend:['get_online_friends',(result,callback)=>{
            console.log("set_fail_friend");
            let complete = 0;
            for(let i=0;i<fail_friends.length;i++){

                redis_client.rpush("id:"+fail_friends[i]+"friendNameChangeList:",JSON.stringify({"id":id,"name":new_name}),(err,reply)=>{
                    if(err){
                        console.log(err);
                        console.log("redis client err set fail friend change name");
                    }
                    complete++;
                    if(complete===fail_friends.length){
                        callback(null);
                    }
                })
                redis_client.get("id:"+fail_friends[i]+"bitmap:",(err,reply)=>{
                    if(err){
                        console.log(err);
                    }else if(reply!=null){
                        bitmap = Number(reply);
                        redis_client.setex("id:"+fail_friends[i]+"bitmap:",3600*24*30,bitmap|0b00000100,(err)=>{
                            if(err){
                                console.log(err);
                            }
                            console.log("in bitmap id:"+fail_friends[i]);
                        });
                    }
                })
                redis_client.expire("id:"+fail_friends[i]+"friendNameChangeList:",3600*24*30,(err)=>{
                    if(err){
                        console.log(err);
                    }
                })

            }
        }]
    },(err)=>{
        if(err===err_types.UNRECOGNIZE_SHORT_TOKEN){
            sendError(socket,err_types.UNRECOGNIZE_SHORT_TOKEN);
        }
    })
}

module.exports=dealChangeName;




function setChangeNameRsp(success){
    let rsp_to_client=new protobuf.RspToClient();
    let change_name_rsp=new protobuf.ChangeName.Rsp();
    change_name_rsp.setSuccess(true);
    rsp_to_client.setChangeNameRsp(change_name_rsp);
    return rsp_to_client;
}

function setChangeNameRelay(id,name){
    let rsp_to_client=new protobuf.RspToClient();
    let relay =  new protobuf.ChangeName.RelayToFriend();
    relay.setId(id);
    relay.setName(name);
    rsp_to_client.setChangeNameRelay(relay)
    return rsp_to_client;
}