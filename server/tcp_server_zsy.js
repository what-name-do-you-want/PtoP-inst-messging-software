//TODO 利用module.exports而非函数传参，实现共享全局变量。
//TODO 把checktoken给抽出来
//TODO rollback（由WZL来写~）
//TODO socket on end error close时会执行什么。
const net = require("net");
const protobuf =require("./test_pb");
const mysql = require('mysql');
const redis = require("redis");
const configs=require('./configs');
const dealRegisterReq=require('./dealRegisterReq');
const dealLoginReq=require('./dealLoginReq');
const dealHeartBeatReq=require('./dealHeartBeatReq');
const dealGetTokenReq=require('./dealGetTokenReq');
const dealFriendList=require('./dealFriendList');
const dealSearchUserReq=require('./dealSearchUserReq');
const dealAddFriendFromAReq=require('./dealAddFriendFromAReq');
const dealAddFriendBToServer=require('./dealAddFriendBToServer');
const dealChatWithServerReq=require('./dealChatWithServerReq');
const dealChatRecordReq=require('./dealChatRecordReq');
const sendError=require("./dealError");
const dealChangeHeadpic=require("./dealChangeHeadpic");
const dealChangeName=require("./dealChangeName");
const dealChangePassword=require("./dealChangePassword");
const dealDeleteFriend=require("./dealDeleteFriend");
const dealSeen=require("./dealSeen");

const err_types=protobuf.Error.Error_type;
const req_types= protobuf.ReqToServer.ReqCase;

const IN_IP = configs.IN_IP;
const PORT = configs.PORT;

var server= net.createServer(); 
var Sockets = {};
var SocketNum = 1;
var long_term_Socks={};
var ltSockNum=1;
var connection_cnt=0;

const redis_client = redis.createClient();

redis_client.on("error", function(error) {
    console.error(error);
});

const mysql_client = mysql.createConnection(configs.mysql_conf);
mysql_client.connect();

server.on('error', function (err){
    console.log('tcp_server error:'+err);
});

server.on('close', function (err) {
    if(err){
        console.log(err);
    }
    console.log('tcp_server close!');
});


server.listen(PORT,IN_IP,function(err){
    if(err){
        throw err;
    }
    console.log(`tcp_server listening on ${PORT}`);
});


server.on('connection',function (socket){
    connection_cnt++;
    console.log("total connection:"+connection_cnt);
    server.getConnections((err,cnt)=>{
        console.log("total cnt by getConnections:"+cnt);
    })
    console.log(`From ${socket.remoteAddress}:${socket.remotePort}, time:${new Date()}`);
    let socket_id=SocketNum;
    Sockets[SocketNum++] =socket;
    socket.setTimeout(140*1000);
    let sock_ids={short_term:socket_id,long_term:null};
    //记录是第一次接收到这个socket传输的数据吗？
    let contact={};
    contact.init=true;

    let len=null;
    let req = Buffer.alloc(0);
    let len_data = Buffer.alloc(0);
    const without_len = 1;
    const without_data = 2;
    let state = without_len;
    let handle_all = false;
    // 客户端异常断开时执行
    socket.on("error", function (err) {
        console.log('client error disconneted:'+err);
        cleanSockets(sock_ids);
    });
    socket.on("end",function(err){
        if(err){
            console.log("end error:"+err);
        }
        console.log("client end");
        cleanSockets(sock_ids);
    });
    // 客户端正常断开时执行
    socket.on('close', function () {
        //TODO !!!!!!!!为什么有很多long_term_socks????
        cleanSockets(sock_ids);
        connection_cnt--;
    });
    socket.on('timeout',function(){
        // SockTrash.push(socket);
        //TODO 这么清理Sockets，合理吗？
        cleanSockets(sock_ids);
        socket.destroy();
    })



    socket.on('data',function(data){

        //data一定是buffer类型的
        //@todo 设置TCP超时 之后处理

        //状态机 未获取到完整长度
        // 获取到完整长度,但是没有获取完整数据
        //获取到完整数据
        // console.log(data);
        handle_all = false;
        while(handle_all===false){
            if(state===without_len){
                if(data.length+len_data.length<4){
                    len_data = Buffer.concat([len_data,data]);
                    data = Buffer.alloc(0);
                }else{
                    let pre_len_data = len_data.length;
                    len_data = Buffer.concat([len_data,data.slice(0,4-pre_len_data)]);
                    data = data.slice(4-pre_len_data);
                    len = len_data.readUInt32BE();
                    len_data = Buffer.alloc(0);
                    state = without_data;
                }
            }
            if(state===without_data){
                // console.log(data);
                // console.log(len);
                // console.log(data.length);
                // console.log(req.length);
                if(len>data.length+req.length){
                    req = Buffer.concat([req,data]);
                    handle_all = true;
                }else if(len===data.length+req.length){
                    req = Buffer.concat([req,data]);
                    dealReq(sock_ids,socket,req,contact);
                    req = Buffer.alloc(0);
                    len = null;
                    state = without_len;
                    handle_all = true;
                }else{
                    let leave_data_length = len - req.length;
                    req = Buffer.concat([req,data.slice(0,leave_data_length)]);
                    dealReq(sock_ids,socket,req,contact);
                    req=Buffer.alloc(0);
                    data = data.slice(leave_data_length);
                    len = null;
                    state = without_len;
                }
            }
        }
    });



});


function dealReq(sock_ids,socket,req,contact){
    console.log("start deal request");
    // console.log(req);
    let socket_id=sock_ids['short_term'];
    let lt_socket_id=sock_ids['long_term'];
    let req_to_server;
    let init_contact=contact.init;
    try {
        req_to_server=protobuf.ReqToServer.deserializeBinary(req);    
    } catch (error) {
        //返回错误：UNKNOWN_MSG
        console.log("unknown errrrrrrrrrrrrrrrrrrrrrrr")
        console.log(error);
        sendError(socket,err_types.UNKNOWN_MSG);
        return;
    }
    let type=req_to_server.getReqCase();
    console.log(`req type:${type}`);
    switch(type){
        case req_types.REGISTER_REQ:
            //req_to_server类型为register_req。
            dealRegisterReq(socket,req_to_server,mysql_client);
            break;
        case req_types.LOGIN_REQ:
            dealLoginReq(socket,req_to_server,redis_client,mysql_client);
            break;
        case req_types.HEART_BEAT_REQ:
            //动态
            if(init_contact){
                sock_ids.long_term=ltSockNum;
                lt_socket_id=ltSockNum;
                long_term_Socks[ltSockNum++]=socket;
                delete Sockets[socket_id];
                sock_ids.short_term=null;
                // init_contact=false;
                contact.init=false;
            }
            dealHeartBeatReq(lt_socket_id,socket,req_to_server,redis_client,mysql_client);
            break;
        case req_types.SEARCH_USER_REQ:
            dealSearchUserReq(socket,req_to_server,redis_client,mysql_client);
            break;
        case req_types.GET_TOKEN_REQ:
            //动态
            dealGetTokenReq(socket,req_to_server,redis_client);
            break;
        case req_types.ADD_FRIEND_A_TO_SERVER:
            console.log("goin!!!!!!!!");
            //TODO WZL,写测试
            dealAddFriendFromAReq(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.ADD_FRIEND_B_TO_SERVER:
            dealAddFriendBToServer(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.CHAT_WITH_SERVER_REQ:
            dealChatWithServerReq(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.FRIENDLIST_REQ:
            dealFriendList(socket,req_to_server,redis_client,mysql_client);
            break;            
		case req_types.CHAT_RECORD_REQ:
            dealChatRecordReq(socket,req_to_server,redis_client,mysql_client);
            break;
        case req_types.CHANGE_PASSWORD_REQ:
            dealChangePassword(socket,req_to_server,redis_client,mysql_client);
            break;
        case req_types.CHANGE_NAME_REQ:
            dealChangeName(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.CHANGE_HEADPIC_REQ:
            dealChangeHeadpic(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.DELETE_FRIEND_A_TO_SERVER:
            //动态回复
            dealDeleteFriend(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;
        case req_types.SEEN_A_TO_SERVER:
            //动态回复。
            dealSeen(socket,req_to_server,redis_client,mysql_client,long_term_Socks);
            break;            
		default:
            sendError(socket,err_types.UNKNOWN_MSG);
            break;

    }
    console.log("end deal");   
}

function cleanSockets(sock_ids){
    let lt_socket_id=sock_ids.long_term;
    let socket_id=sock_ids.short_term;
    if(socket_id){
        delete Sockets[socket_id];
		delete sock_ids.short_term;
        console.log("successfully delete Sockets "+socket_id);
    }
    if(lt_socket_id){
        delete long_term_Socks[lt_socket_id];
		delete sock_ids.long_term;
        console.log("successfully delete long_term_Socks "+lt_socket_id);
    }
    // socket.destroy();
}