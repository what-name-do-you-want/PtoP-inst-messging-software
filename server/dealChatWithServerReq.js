const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealChatWithServerReq(socket,req_to_server,redis_client,mysql_client,long_term_Socks){
    console.log("begin dealChatWithServerReq");
    let chat_with_server_req=req_to_server.getChatWithServerReq();
    let short_token=chat_with_server_req.getShortToken();
    let obj_id=chat_with_server_req.getObjId();
    let time=chat_with_server_req.getTime();
    let content=chat_with_server_req.getContent();
    let my_id;
    let obj_socket=null;
    let request_id;
    let send=false;
    //1.1、验证token
    //2、根据obj_id找出obj_sock
    //3.1、转发content
    //3.2、将content写入chat_record
    //4、若失败，写入temp_chat_record。
    async.auto({
        get_my_id:function(callback){
            redis_client.get("short_token:"+short_token,function(err,reply){
                if(err){
                    callback(err_types.UNKNOWN_CHAT_ERR);
                }
                else if(reply==null){
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN);
                }
                else{
                    my_id=Number(reply);
                    callback(null);
                }
            });

        },
        get_obj_socket:["get_my_id",function(res,callback){
            redis_client.get("id:"+obj_id+'socket:',function(err,reply){
                if(err||reply===null){
                    // console.log(err);
                    callback(null);
                }
                else{
                    obj_socket_id=Number(reply);
                    obj_socket=long_term_Socks[obj_socket_id];
                    callback(null);
                }
            })
        }],
        set_chat_record:["get_obj_socket",function(res,callback){
            mysql_client.query("INSERT INTO chat_record(sender,receiver,time,content) values(?,?,?,?)",[my_id,obj_id,time,content],function(err,results){
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_CHAT_ERR);
                    //TODO rollback 我不会  WZL写
                }
                else{
                    request_id=results.insertId;
                    // console.log(request_id);
                    callback(null);
                }
            })
        }],
        send_rsp:["get_obj_socket",function(res,callback){
            //
            if(obj_socket===null||obj_socket===undefined || obj_socket.destroyed){
                callback(null);
            }
            else{
                let rsp_to_client=new protobuf.RspToClient();          
                let chat_with_server_relay=new protobuf.ChatWithServer.Relay();
                chat_with_server_relay.setSrcId(my_id);
                chat_with_server_relay.setContent(content);
                chat_with_server_relay.setTime(time);
                rsp_to_client.setChatWithServerRelay(chat_with_server_relay);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);  
                obj_socket.write(rsp_buf,function(err){
                    //发送失败
                    if(err){
                        console.log(err);
                    }
                    send=err?false:true;
                    callback(null);

                });
            }
        }],
        set_tmp:["send_rsp","set_chat_record",function(res,callback){
            if(send==true){
                callback(null);
            }
            else{
                console.log("record id:"+request_id);
                mysql_client.query("insert into temp_chat_record(temp_chat_record_id) values(?)",request_id,
                function(err,results,fields){
                    if(err){
                        console.log(err);
                    }
                    callback(null);
                });
            }
        }],

        set_redis: ["send_rsp", function (res, callback) {
            if(send){
                callback(null);
            }
            else{
                redis_client.get("id:"+obj_id+"bitmap:",(err,reply)=>{
                    let bitmap=Number(reply);
                    let new_bitmap=bitmap | 0b10000000;
                    redis_client.setex("id:"+obj_id+"bitmap:",3600*24*30+10,new_bitmap,()=>{
                        callback(null);
                    });
                })
            }
        }]
    },function(err,results){
        if(err!=null){
            console.log(err);
            sendError(socket,err);
        }
        console.log("dealChatWithServerReq end");
    });
}

module.exports=dealChatWithServerReq;