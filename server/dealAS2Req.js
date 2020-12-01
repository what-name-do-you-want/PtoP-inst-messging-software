const protobuf=require("./test_pb");
const utils=require("./utils");
const async=require("async");

function dealAS2Req(socket,req,redis_client,long_term_Socks){
    let A_S2_req = req.getAS2Req();
    let B_id = A_S2_req.getBid();
    let A_id;
    let A_token = A_S2_req.getToken();
    let B_socket_id;
    let B_socket;
    let B_offline;
    //检查token
    //检查B是否在线
    //返回给A相关的数据
    //返回给B相关的数据
    async.auto({
        check_token:(callback)=>{
            redis_client.get("short_token:"+A_token,function(err,reply){
                if(err){
                    console.log(err);
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                }else{
                    A_id = parseInt(reply);
                    callback(null);
                }
            })
        },
        check_B_online:['check_token',(result,callback)=>{
            redis_client.get("id:"+B_id+'socket:',function(err,reply){
                if(err||reply===null){
                    // console.log(err);
                    B_offline = true;
                    callback(null,true);
                }
                else{
                    B_socket_id=Number(reply);
                    B_socket=long_term_Socks[B_socket_id];
                    B_offline =(B_socket===undefined || B_socket===null || B_socket.destroyed)?true:false;
                    callback(null,B_offline);
                }
            })
        }],
        send_info_to_A:['check_B_online',(result,callback)=>{
            let rsp = new protobuf.RspToClient();     
            let S2_to_A=new protobuf.PToP.S2ARsp();
            S2_to_A.setOffline(result.check_B_online);
            S2_to_A.setId(B_id);
            rsp.setS2Rsp(S2_to_A);
            let rsp_buf=utils.toBufferAndPrependLen(rsp);  
            socket.write(rsp_buf,function(err){
                //发送失败
                if(err){
                    console.log(err);
                }
                callback(null);
            });
        }],
        relay_to_B:['check_B_online',(result,callback)=>{
            if(B_offline===false){
                let rsp = new protobuf.RspToClient();  
                let relay_to_B=new protobuf.PToP.S2BRelay();
                relay_to_B.setAid(A_id);
                rsp.setS2BRelay(relay_to_B);
                let buf = utils.toBufferAndPrependLen(rsp);
                B_socket.write(buf,(err)=>{
                    if(err){
                        console.log(err);
                    }
                    callback(null);
                })
            }   
        }]
    },(err)=>{
        if(err){
            console.log(err);
        }
    });
}

module.exports=dealAS2Req;