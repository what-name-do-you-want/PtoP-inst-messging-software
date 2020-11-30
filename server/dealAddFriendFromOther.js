function dealAddFriendRequestFromOther(socket,req_to_server,redis_client,mysql_client,Sockets){
    let from_other_req = req_to_server.getAddFriendRequestFromOtherReq();
    let short_token = from_other_req.getShortToken();
    let id;
    //检测token
    //取数据
    //发送数据

    async.series([
        function(callback){//检测token
            redis_client.get("short_token"+short_token,(err,reply)=>{
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
                "select id,name,headpic "+ 
                "from userinfo,request_for_add_friend "+
                "where "+
                    "id_which_request_to = ? and "+
                    "id = id_which_request_from",[id],
                (err,sql_results)=>{
                    if(err){
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
            let from_other_res = new protobuf.AddFriendRequestFromOther.Rsp();

            let sql_results= results[1];
            let len = sql_results.length;

            for(let i=0;i<len;i++){
                let result = sql_results[i];
                let user_info = new protobuf.People();
                user_info.setId(result.id);
                user_info.setName(result.name);
                user_info.setHeadpic(result.headpic);
                from_other_res.addUser(user_info);
            }
            
            rsp_to_client.setAddFriendRequestFromOtherRes(from_other_res);
            let res_buf = toBufferAndPrependLen(rsp_to_client);
            socket.write(res_buf);
        }
    }
    )
}