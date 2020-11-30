const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealSeen(socket,req_to_server,redis_client,mysql_client,long_term_Socks){
    console.log("begin dealSeen");
    let seen_req = req_to_server.getSeenAToServer();
    let short_token = seen_req.getShortToken();
    let obj_id = seen_req.getObjId();
    let time=seen_req.getTime();
    let id;
    let obj_socket=null;
    async.waterfall([
        function (callback){ //checktoken
            redis_client.get("short_token:"+short_token,function(err,reply){
                if(err){
                    console.log(err);
                    console.log("in dealSeen:unrec short token");
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                }else{
                    id = parseInt(reply);
                    callback(null);
                }
            })
        },
        function(callback){
            //取出受害者的long term sock。
            redis_client.get("id:"+obj_id+"socket:",(err,reply)=>{
                if(err || reply === null || !long_term_Socks[reply] || long_term_Socks[reply].destroyed===true){
                    //B不在线(正常情况下这时long_term_Socks对应的键已经被我们删除了)
                    callback(null);
                }else{
                    obj_socket = long_term_Socks[reply];
                    callback(null);
                }
            });
        },
        function(callback){
            if(obj_socket){
                //如果受害者在线，将喜讯发给受害者。
                let rsp_to_client=new protobuf.RspToClient();
                let seen_rsp=new protobuf.Seen.ServerToB();
                let info=new protobuf.Seen.ServerToB.SeenInfo();
                info.setSrcId(id);
                info.setTime(time);
                seen_rsp.addSeenInfo(info);
                // console.log(info);
                rsp_to_client.setSeenServerToB(seen_rsp);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                obj_socket.write(rsp_buf,(err)=>{
                    if(err){
                        console.log(err);
                        console.log("in dealSeen:send seen fail");
                        callback(null,false);
                    }
                    else
                        callback(null,true);
                });
            }
            else{
                callback(null,false);
            } 
        },
        function(send,callback){
            if(!send){
                mysql_client.query("insert into temp_seen values(?,?,?)",[id,obj_id,time],(err)=>{
                    if(err){
                        console.log(err);
                        console.log("in dealSeen:insert into seen fail");
                    }
                    callback(null,send);
                })   
            }
            else{
                callback(null,send);
            }
        },
        function(send,callback){
            if(send){
                callback(null);
            }
            else{
                redis_client.get("id:"+obj_id+"bitmap:",(err,reply)=>{
                    let bitmap=Number(reply);
                    let new_bitmap=bitmap | 0b00010000;
                    redis_client.setex("id:"+obj_id+"bitmap:",3600*24*30+10,new_bitmap,()=>{
                        callback(null);
                    });
                })
            }
        }
    ],function(err,results){
        if(err){
            sendError(socket,err);
        }
        console.log("dealSeen end");
    });
}

module.exports=dealSeen;