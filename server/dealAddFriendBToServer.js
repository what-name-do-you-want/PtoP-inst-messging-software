const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealAddFriendBToServer(socket,req_to_server,redis_client,mysql_client,long_term_Socks){
    console.log("begin dealAddFriendBToServer!!!!!!!!!!!!!!!!!!!!!!!!!!!1");
	let add_friend_b_to_server=req_to_server.getAddFriendBToServer();
    let A_id=add_friend_b_to_server.getAId();
    //0:agree 1:refuse
    let refuse=add_friend_b_to_server.getRefuse();
    let B_short_token=add_friend_b_to_server.getBShortToken();
    let B_id;
    let B_name;
    let B_headpic;
    let request_id;
    let a_socket_id;
    let a_socket;
    let send=false;
    let state;
    async.auto({
        get_B_id:function(callback){
            console.log("dealAddFriendBToServer get b id start");
            redis_client.get("short_token:"+B_short_token,function(err,reply){
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_ADD_ERR);
                }
                else if(reply==null){
                    console.log("unrec short token");
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN);
                }
                else{

                    B_id=Number(reply);
                    console.log("BBBBBBBBBBBBBBBBBBBBBBBBBbbb_id");
					console.log("b_id:"+B_id);
                    callback(null);
                }
            });

        },

        check_A_to_B:["get_B_id",function(res,callback){
            console.log("dealAddFriendBToServer check A to B");
            mysql_client.query("select id_which_request_from, id_which_request_to, request_id from request_for_add_friend "
            +"where id_which_request_from=? and id_which_request_to=? and state=0x00",[A_id,B_id],function(err,results,fields){
                if(err || results.length==0){
                    console.log("check A_to B")
					console.log(err);
                    callback(err_types.UNKNOWN_ADD_ERR);
                }
                else{
					console.log("there is a to b");
                    request_id=results[0].request_id;
                    callback(null);
                }            
            });
        }],

        get_B_info:["check_A_to_B",function(res,callback){
            console.log("addfriend check A+to_server");
            mysql_client.query("select name,headpic from userinfo where id=?",B_id,(err,results)=>{
                if(err || results===null || results.length==0){
                    console.log("addfriend b to sever Binfo");
                    callback(err_types.UNKNOWN_ADD_ERR);
                }
                else{
					console.log("get b name");
                    B_name=results[0].name;
                    B_headpic=results[0].headpic;
                    callback(null);
                }
            });
        }],

        set_request_for_add_friend:["check_A_to_B",function(res,callback){
            //00:wait 01:agree 10:refuse
            //目前没有过期状态。
            console.log("addfriend b to sever set request for add friend");
            state=refuse?0b10:0b01;
            mysql_client.query("update request_for_add_friend set state = ? where request_id=?",
            [state,request_id],function(err,results,fields){
                if(err){
                    console.log(err);
                    callback(err_types.UNKNOWN_ADD_ERR);
                }
                else{
                    callback(null);
                }
            });

        }],
        set_friends:["check_A_to_B",function(res,callback){
            console.log("addfriend b to sever set friends");
            if(refuse==false){
                mysql_client.query('INSERT INTO friends(id1,id2)  values(?,?)',[A_id,B_id],function(err,results,field){
                    if(err){
                        console.log(err);
                        callback(err_types.UNKNOWN_ADD_ERR);
                    }
                    else{
                        callback(null);
                    }
                });
            }
            else{
                callback(null);
            }
        }],
        get_a_socket:["check_A_to_B",function(res,callback){
            console.log("addfriend b to sever get a socket");
            redis_client.get("id:"+A_id+'socket:',function(err,reply){
                if(err || reply===null){
                    console.log('cannot get a_socket');
                }
                else{
                    console.log('get a_socket');
                    a_socket_id=reply;
                    a_socket=long_term_Socks[a_socket_id];
                }
                callback(null);
            })
        }],
        //TODO 这里完全不执行了，为什么？
        send_rsp:["get_a_socket","get_B_info",function(res,callback){
            //     
            console.log("addfriend b to sever send rsp");    
            if(a_socket===undefined  ||a_socket===null || a_socket.destroyed){
                console.log('a is not online');
                callback(null);
            }
            else{
				console.log("ready to rsp");
                let rsp_to_client=new protobuf.RspToClient();
                let add_rsp=new protobuf.AddFriendFromSelf.Rsp();
                let req_from_self=new protobuf.AddFriendFromSelf.Rsp.RequestFromSelf();
                let B_info=new protobuf.People();
                B_info.setName(B_name);
                B_info.setId(B_id);
                B_info.setHeadpic(B_headpic);
                console.log("B_info ok");
                req_from_self.setObjUser(B_info);
                console.log("req_from_self.setObjUser(B_info)");
                let state_buf=Buffer.alloc(1,state);
                req_from_self.setStatus(state_buf);
                console.log("req_from_self.setStatus(state)");
                add_rsp.addRequests(req_from_self);
                console.log("add_rsp.addRequests(req_from_self)");
                rsp_to_client.setAddFriendFromSelfRsp(add_rsp);  
                console.log("rsp_to_client.setAddFriendFromSelfRsp(add_rsp)");   
                let rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);  
                a_socket.write(rsp_buf,function(err){
                    send=err?false:true;
                    if(err){
                        console.log(err);
                        console.log("in dealAddFriendBToServer:tell a err");
                    }
                    callback(null);
                });
            }
        }],
        set_tmp:["send_rsp",function(res,callback){
            console.log("addfriend b to sever set tmp");
            if(send===true){
                console.log("send==true");
                callback(null);
            }
            else{
                mysql_client.query("INSERT INTO temp_response_to_add_friend(rsp_id) values(?)",request_id,function(err,results,fields){
                    if(err){
                        console.log(err);
                        console.log("set temp_response_to_add_friend fail");
                    }
                    else{
                        console.log(`set temp_response_to_add_friend success, rsp_id=${request_id} and send=${send}`);
                    }
                    callback(null);
                });
            }
        }]
    },function(err,results){
        //TODO 处理set request_for_add_friend或friends错误
        console.log('dealAddFriendBToServer end');
        if(err){
            console.log(err);
            sendError(socket,err);
        }
    });
    console.log("end solution");
}

module.exports=dealAddFriendBToServer;