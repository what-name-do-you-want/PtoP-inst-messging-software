const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealChangeHeadpic(socket,req_to_server,redis_client,mysql_client,long_term_sockets){
    console.log("begin dealChangeHeadpic");
    let change_headpic_req = req_to_server.getChangeHeadpicReq();
    let short_token = change_headpic_req.getShortToken();
    let new_headpic = change_headpic_req.getNewHeadpic();
    console.log(new_headpic);
    let id;
    let friends;
    let fail_friends = [];
    async.auto({
        check_token:function (callback){ //checktoken
            console.log("check token");
            redis_client.get("short_token:"+short_token,function(err,reply){
                if(err || !reply){
                    console.log(err);
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                }else{
                    id = parseInt(reply);
                    callback(null);
                }
            })
        },
        update_headpic:['check_token',function (result,callback){
            console.log("update headpic ");
            mysql_client.query("update `userinfo` set headpic = ? where id =?",[Buffer.from(new_headpic),id],(err,sql_result)=>{
                if(err){
                    console.log(err);
                    console.log("in dealChangeheadpic:set db fail");
                    let rsp=setHeapicRsp(false);
                    let rsp_buf = utils.toBufferAndPrependLen(rsp);
                    socket.write(rsp_buf,(err)=>{
                        console.log(err);
                    });
                    //callback(err_types.UNKNOWN_CHANGE_ERR)
                    callback(err_types.UNKNOWN_CHANGE_ERR);
                }else{
                    let rsp=setHeapicRsp(true);
                    let rsp_buf = utils.toBufferAndPrependLen(rsp);
                    socket.write(rsp_buf);
                    callback(null);
                }
            })
        }],
        get_friends:['update_headpic',(result,callback)=>{
            console.log("get friends");
            redis_client.lrange("id:"+id+"friendlist:",0,-1,(err,reply)=>{
                if(err){
                    console.log("change name err with redis time:"+ (new Date()));
                    console.log(err);
                    callback(err_types.UNKNOWN_CHANGE_ERR);
                }else{
                    friends = reply;
                    callback(null);
                }

            })
        }],
        get_online_friends:['get_friends',(result,callback)=>{
            console.log("get online friends");
            let all_complete = 0;
            for(let i=0;i<friends.length;i++){
                fail_friends.push(friends[i]);
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
                            let relay = setChangeHeadpicRelay(id,new_headpic);
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
            //callback(null);
        }],
        set_fail_friend:['get_online_friends',(result,callback)=>{
            console.log("set fail friends");
            let complete = 0;
            for(let i=0;i<fail_friends.length;i++){
                redis_client.rpush("id:"+fail_friends[i]+"friendHeadChangeList:",id,(err,reply)=>{
                    if(err){
                        console.log(err);
                        console.log("redis client err set fail friend change head");
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
                        redis_client.setex("id:"+fail_friends[i]+"bitmap:",3600*24*30,bitmap|0b00000010,(err)=>{
                            if(err)
                                console.log(err);
                        });
                    }
                })
                redis_client.expire("id:"+fail_friends[i]+"friendHeadChangeList:",3600*24*30,(err)=>{
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

module.exports=dealChangeHeadpic;

function setHeapicRsp(success){
    let rsp_to_client=new protobuf.RspToClient();
    let change_headpic_rsp=new protobuf.ChangeHeadpic.Rsp();
    change_headpic_rsp.setSuccess(true);
    rsp_to_client.setChangeHeadpicRsp(change_headpic_rsp);
    return rsp_to_client;
}

function setChangeHeadpicRelay(id,headpic){
    let rsp_to_client=new protobuf.RspToClient();
    let relay =  new protobuf.ChangeHeadpic.RelayToFriend();
    relay.setId(id);
    relay.setHeadpic(headpic);
    rsp_to_client.setChangeHeadpicRelay(relay)
    return rsp_to_client;
}