const net = require("net");
const protobuf =require("./test_pb");
const utils = require("./utils.js");

function dealS2InfoReq(socket,req,long_term_Socks){
    let info = getS2InfoReq(req);
    //检查token
    //分析mode
    //mode 
    //ip,port不变,
    //ip 发生改变
    //ip不变 port发生改变
    // /// // / port增加
    /////////// port减少 
    //如果穿透失败 间隔一定时间 重新开始穿透
    //需要返回一个值
    //从心跳的端口返回
    //发起socket应该和心跳端口相同
    const diffent_ip = 1;
    const cant_get_obj_socket = 2;
    let S1_seen_ip = info.ip;
    let S1_seen_port = info.port;
    let S2_seen_ip;
    let S2_seen_port;
    let short_token = info.token;
    let obj_id = info.id;
    let src_id;
    let obj_socket_id;
    let obj_socket;
    let mode;
    async.auto({
        check_token:(callback)=>{
            redis_client.get("short_token:"+short_token,function(err,reply){
                if(err){
                    console.log(err);
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                }else{
                    src_id = parseInt(reply);
                    callback(null);
                }
            })
        },
        get_S2_seen:(result,callback)=>{
            S2_seen_ip = socket.remoteAddress;
            S2_seen_port = socket.remotePort;
            callback(null);
        },
        analyse_mode:["get_S2_seen",(result,callback)=>{
            if(S2_seen_ip!=S1_seen_ip){
                //直接返回
                callback(diffent_ip);
            }else if(S2_seen_port===S1_seen_port){
                //port不变
                //mode = 0
                mode = 0;
                callback(null);
            }else if(S2_seen_port>S1_seen_port){
                //增加
                mode = 1;
                callback(null);
            }else{
                //减少
                mode = 2;
                callback(null);
            }
            //callback
        }],
        get_obj_socket:["get_S2_seen",(result,callback)=>{
            redis_client.get("id:"+obj_id+'socket:',function(err,reply){
                if(err || reply ===null){
                    //TODO 获取不到m目标socket,直接放弃
                    if(err)console.log(err);
                    callback(cant_get_obj_socket);
                }else{
                    obj_socket_id = parseInt(reply);
                    obj_socket = long_term_Socks[obj_socket_id];
                    callback(null);
                }
            })
        }],
        send_mode_to_obj:["analyse_mode","get_obj_socket",(result,callback)=>{
            //检查目标socket是否可用
            if(obj_socket===undefined||obj_socket===null||obj_socket.destroyed){
                //直接返回
                callback(cant_get_obj_socket);
            }else{
                //尝试发送
                let rsp = setRelay(src_id,utils.ip_str_to_num(S1_seen_ip),S1_seen_port,mode);
                let buf = utils.toBufferAndPrependLen(rsp);
                obj_socket.write(buf,(err)=>{
                    if(err){
                        console.log(err);
                    }
                })
                callback(null);
            }

        }]

    },(err)=>{
        if(err){
            if(err==diffent_ip){
                console.log("not the same ip!");
            }else if(err==cant_get_obj_socket){
                console.log("cant get the heartbeat socket from longterm");
            }else{
                console.log("unrecognize token");
            }
        }
    })

}

function setRelay(id,ip,port,mode){
    let req_to_server=new protobuf.ReqToServer();
    let relay_rsp = new protobuf.PToP.S2InfoRsp();
    relay_rsp.setId(id);
    relay_rsp.setIp(ip);
    relay_rsp.setPort(port);
    relay_rsp.setMode(mode);
    req_to_server.setS2InfoRsp(relay_rsp);
    return req_to_server;
}

function getS2InfoReq(req){
    let info = req.getS2InfoReq();
    let id = info.getId();
    let ip = info.getS1ip();
    let port = info.getS1port();
    let token = info.getToken();
    return {"id":id,"ip":ip,"port":port,"token":token};
}

module.exports=dealS2InfoReq;