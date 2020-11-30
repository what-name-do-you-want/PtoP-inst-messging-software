const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
//静态req&res
function dealFriendList(socket,req_to_server,redis_client,mysql_client){
    let get_friendlist_req=req_to_server.getFriendlistReq();
    let short_token = get_friendlist_req.getToken();
    let id;
    async.auto({
        check_short_token:function(callback){
            redis_client.get("short_token:"+short_token,(err,reply)=>{
                if(err){
                    callback(err_types.UNKNOWN_FRIEND_ERR);
                }else if(reply===null){
                    callback(err_types.UNRECOGNIZE_TOKEN);
                }else{
                    id = parseInt(reply);
                    callback(null);
                    
                    //console.log(typeof reply);
                }
            })
        },
        get_friendlist:['check_short_token',function(results,callback){
            mysql_client.query(
                'select id,name,headpic from userinfo,friends where id1 = ? and id = id2 union '+
                'select id,name,headpic from userinfo,friends where id2 = ? and id = id1',[id,id],(err,sql_results)=>{
                    if(err){
                        callback(err_types.UNKNOWN_FRIEND_ERR);
                    }else{
                        console.log("results length:"+sql_results.length);
                        console.log(sql_results);
                        callback(null,sql_results);

                    }
                })
        }]},function(err,results){
            if(err){
                console.log("there are some err");
                sendError(socket,err);
            }else{
                let rsp_to_client=new protobuf.RspToClient();
                let frindlist_rsp = new protobuf.FriendList.Rsp();
                for(var i = 0;i<results.get_friendlist.length;i++){
                    console.log("friend_infoffffffffffffffff");
                    let friend_info = results.get_friendlist[i];
                    let friend = new protobuf.People();
                    friend.setId(friend_info.id);
                    friend.setName(friend_info.name);
                    friend.setHeadpic(friend_info.headpic);
                    frindlist_rsp.addFriendList(friend);
                    console.log(frindlist_rsp);
                }
                rsp_to_client.setFriendlistRes(frindlist_rsp);
                let rsp_buf = utils.toBufferAndPrependLen(rsp_to_client);
                socket.write(rsp_buf);
            }
        })
}

module.exports=dealFriendList;