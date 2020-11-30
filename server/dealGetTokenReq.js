const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
//动态的
function dealGetTokenReq(socket,req_to_server,redis_client){
    let get_token_req=req_to_server.getGetTokenReq();
    let long_token=get_token_req.getLongToken();
    let id;
    let password;
    let short_token;
    async.series({
        get_id:function(callback){
            redis_client.get("long_token:"+long_token,function(err,reply){
                if(err){
                    callback(err_types.UNKNOWN_GETTOKEN_ERR);
                }
                else if(reply==null){
                    callback(err_types.UNRECOGNIZE_LONG_TOKEN);
                }
                else{
                    id=reply;
                    callback(null);
                }
            });
        },
        get_password:function(callback){
            redis_client.get("id:"+id+"pwd:",function(err,reply){
                if(err){
                    callback(err_types.UNKNOWN_GETTOKEN_ERR);
                }
                else{
                    password=reply;
                    callback(null);
                }
            });
        },
        create_short_token:function(callback){
            short_token=utils.generate_short_token(id,password);
            callback(null);
        },
        set_redis:function(callback){
            redis_client.setex("short_token:"+short_token,3600+10,id,function(err,reply){
                if(err){
                    callback(err);
                }
                else{
                callback(null);
                }
            });

        },
    },function(err,results){
        if(err!=null){
            console.log(err);
            sendError(socket,err);
        }
        else{
            let d=new Date();
            // let start_time=d.getTime();
            let rsp_to_client=new protobuf.RspToClient();
            let get_token_res=new protobuf.GetToken.Res();
            get_token_res.setShortToken(short_token);
            // get_token_res.setStartTime(start_time);
            rsp_to_client.setGetTokenRes(get_token_res);
            let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
            socket.write(rsp_buf);
        }
    });
}

module.exports=dealGetTokenReq;