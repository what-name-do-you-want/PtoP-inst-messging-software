const async = require("async");
const protobuf = require("./test_pb");
const utils = require("./utils");
const sendError = require("./dealError");
const err_types = protobuf.Error.Error_type;
function dealDeleteFriend(socket, req_to_server, redis_client, mysql_client, long_term_Socks) {
    console.log("begin dealDeleteFriend");
    let del_req = req_to_server.getDeleteFriendAToServer();
    let short_token = del_req.getShortToken();
    let obj_id = del_req.getObjId();
    let id;
    let obj_socket = null;
    let send=false;
    console.log("victim id:" + obj_id);
    async.series([
        function (callback) { //checktoken
            redis_client.get("short_token:" + short_token, function (err, reply) {
                if (err || !reply) {
                    // console.log(err);
                    // console.log("unrec")
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN)
                } else {
                    id = parseInt(reply);
                    console.log("sender id:" + id);
                    callback(null);
                }
            })
        },
        function (callback) {//删除好友
            mysql_client.query("delete from friends where (id1=? and id2=?) or " +
                "(id2=? and id1=?)", [id, obj_id, id, obj_id], (err, sql_result) => {
                    if (err) {
                        console.log(err);
                        callback(err_types.UNKNOWN_DEL_ERR);
                    } else {
                        console.log("delete friend success");
                        callback(null);
                    }
                })
        },
        function (callback) {
            //取出受害者的long term sock。
            redis_client.get("id:" + obj_id + "socket:", (err, reply) => {
                if (err || reply === null || long_term_Socks[reply] === null || long_term_Socks[reply] === undefined || long_term_Socks[reply].destroyed === true) {
                    //B不在线
                    callback(null);
                } else {
                    obj_socket = long_term_Socks[reply];
                    callback(null);
                }
            });
        },
        function (callback) {
            if (obj_socket) {
                //如果受害者在线，将喜讯发给受害者。
                let rsp_to_client = new protobuf.RspToClient();
                let del_rsp = new protobuf.DeleteFriend.ServerToB();
                del_rsp.addSrcId(id);
                rsp_to_client.setDeleteFriendServerToB(del_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                obj_socket.write(rsp_buf, (err) => {
                    if (err) {
                        console.log(err);
                        mysql_client.query("insert into temp_del_friend values(?,?)", [id, obj_id], (err) => {
                            if (err) {
                                console.log(err);
                            }
                            else {
                                console.log("set temp_del_friend values ok");
                            }
                            callback(null);
                        })
                    }
                    else {
                        console.log("send delete to victim");
                        send=true;
                        callback(null);
                    }

                });
            }
            else{
                callback(null);
            }
        },
        function(callback){
            if(send){
                callback(null);
            }
            else{
                mysql_client.query("insert into temp_del_friend values(?,?)", [id, obj_id], (err) => {
                    if (err) {
                        console.log(err);
                    }
                    else {
                        console.log("set temp_del_friend values ok");
                    }
                    callback(null);
                })  
            }
        },
        function (callback) {
            if(send){
                callback(null);
            }
            else{
                redis_client.get("id:"+obj_id+"bitmap:",(err,reply)=>{
                    let bitmap=Number(reply);
                    let new_bitmap=bitmap | 0b00001000;
                    redis_client.setex("id:"+obj_id+"bitmap:",3600*24*30+10,new_bitmap,()=>{
                        callback(null);
                    });
                })
            }
        }
    ], function (err, results) {
        if (err) {
            sendError(socket, err);
        }
        console.log("DeleteFriend end");
    });
}

module.exports = dealDeleteFriend;