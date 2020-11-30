const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealChangePassword(socket,req_to_server,redis_client,mysql_client){
    console.log("begin dealChangePassword");
    //获取相关数据
    let change_password_req = req_to_server.getChangePasswordReq();
    let short_token = change_password_req.getShortToken();
    let new_password = change_password_req.getNewPassword();
    let id;
    async.series([
        function (callback){ //checktoken
            redis_client.get("short_token:"+short_token,function(err,reply){
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
        function (callback){//更改psw
            mysql_client.query("update userinfo set password = ? where id =?",[new_password,id],(err,sql_result)=>{
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_CHANGE_ERR)
                }else{
                    callback(null);
                }
            })
        },
        function(callback){
            let rsp_to_client=new protobuf.RspToClient();
            let change_password_rsp=new protobuf.ChangePassword.Rsp();
            change_password_rsp.setSuccess(true);
            rsp_to_client.setChangePasswordRsp(change_password_rsp);
            let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
            socket.write(rsp_buf,(err)=>{
                if(err){
                    console.log(err);
                }
                callback(null);
            });
        }
    ],function(err,results){
        if(err){
            sendError(socket,err);
        }
        console.log("dealChangePassword end");
    });


}

module.exports=dealChangePassword;