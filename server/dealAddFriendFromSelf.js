
function dealAddFriendRequestFromSelf(socket,req_to_server){
    let from_self_req = req_to_server.getAddFriendRequestFromSelfReq();
    let short_token = from_self_req.getShortToken();
    let id;
    async.series([
        function(callback){//检测token
            redis_client.get("short_token:"+short_token,(err,reply)=>{
                if(err){
                    console.log(err);
                    callback(err_types.UNRECOGNIZE_TOKEN);
                }else{
                    id = parseInt(reply);
                    callback(null);
                }
            })
        },
        function(callback){
            mysql_client.query(
                "select id,name,headpic,state from userinfo,request_for_add_friend "+
                "where id_which_request_from = ? and id_which_request_to = id",
                [id],(err,sql_results)=>{
                    if(err){
                        console.log(err);
                        callback(err_types.UNKNOWN_ADD_REQ_ERR);
                    }else{
                        callback(null,sql_results);
                    }
                })
        }
    ],function(err,results){
        if(err){
            sendError(socket,err);
        }else{
            
            let rsp_to_client=new protobuf.RspToClient();
            let from_self_res = new protobuf.AddFriendRequestFromSelf.Rsp();
            
            let sql_results = results[1];
            let len = sql_results.length;

            for(let i=0;i<len;i++){
                result = sql_results[i];
                let refuse = result.state.readUInt8()===0?false:true;

                let request = new protobuf.AddFriendRequestFromSelf.Rsp.RequestFromSelf();
                let user_info = new protobuf.People();
                
                user_info.setId(result.id);
                user_info.setName(result.name);
                user_info.setHeadpic(result.headpic);

                request.setObjUser(user_info);
                request.setRefuse(refuse);
                from_self_res.addRequests(request);
            }

            rsp_to_client.setAddFriendRequestFromSelfRes(from_self_res);
            let rsp_buf = toBufferAndPrependLen(rsp_to_client);
            socket.write(rsp_to_client);
        }
    })
}