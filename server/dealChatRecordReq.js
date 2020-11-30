const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
//静态。
function dealChatRecordReq(socket,req_to_server,redis_client,mysql_client){
    let chat_record_req=req_to_server.getChatRecordReq();
    let short_token=chat_record_req.getShortToken();
    let obj_id=chat_record_req.getObjId();
    let last_time=chat_record_req.getTime();
    let my_id;

    //1、用short_token取出my_id；
    //2、用obj_id取出last_time之前的chat_record。最多50条。
    //3、发送。
    
    async.auto({
        get_my_id:function(callback){
            redis_client.get("short_token:"+short_token,(err,reply)=>{
                if(err){
                    callback(err_types.UNKNOWN_CHATREC_ERR);
                }else if(reply===null){
                    callback(err_types.UNRECOGNIZE_TOKEN);
                }else{
                    my_id = Number(reply);
                    callback(null);
                }
            })
        },
        get_chat_record:["get_my_id",function(results,callback){
            console.log("get chat record~~~~~");
            mysql_client.query('select sender,time,content from chat_record '
            +'where receiver=? and sender=? and time<? union select sender,time,content from chat_record where receiver=? '+
            'and sender=? and time<? order by time desc limit 50',[my_id,obj_id,last_time,obj_id,my_id,last_time],(err,res,field)=>{
                console.log("sender:"+my_id);
                console.log("receiver:"+obj_id);
                console.log("time:"+last_time);
                console.log(res);
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_CHATREC_ERR)
                }else{
                    callback(null,res);
                }
            })
        }]},function(err,results){
            if(err){
                sendError(socket,err);
            }else{
                let rsp_to_client=new protobuf.RspToClient();
                let chat_record_rsp=new protobuf.ChatRecord.Rsp();

                for(let i=0;i<results.get_chat_record.length;i++){
                    let msg=new protobuf.ChatRecord.Rsp.Msg();
                    let info=results.get_chat_record[i];
                    msg.setSender(info.sender);
                    msg.setContent(info.content);
                    msg.setTime(info.time);
                    chat_record_rsp.addMsg(msg);
                }
                chat_record_rsp.setObjId(obj_id);
                // console.log(chat_record_rsp);
                rsp_to_client.setChatRecordRsp(chat_record_rsp);
                // console.log(rsp_to_client);
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                socket.write(rsp_buf);
            }
        })

}

module.exports=dealChatRecordReq;