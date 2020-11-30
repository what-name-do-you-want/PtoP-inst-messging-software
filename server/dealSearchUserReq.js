const async=require("async");
const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealSearchUserReq(socket,req_to_server,redis_client,mysql_client){
    let search_user_req = req_to_server.getSearchUserReq();
    let obj_id = search_user_req.getObjId();
    let short_token = search_user_req.getShortToken();
    async.series({
        check_token:function(callback){
            redis_client.get("short_token:"+short_token,function(err,reply){
                if(err){
                    console.log("unknown err");
                    callback(err_types.UNKNOWN_SEARCH_ERR);
                }else if(reply===null){
                    console.log("unrecognize token");
                    callback(err_types.UNRECOGNIZE_SHORT_TOKEN);
                }else{
                    callback(null);
                }
            }) 
        },
        search_user:function(callback){
            mysql_client.query('select id,name,headpic from userinfo where id = ?',obj_id,function(err,results,fields){
                if(err){
                    callback(err_types.UNKNOWN_SEARCH_ERR);
                }else if(results.length===0){
                    console.log("no exist user");
                    callback(err_types.USER_NO_EXIST);
                }else{
                    callback(null,results);
                }
            })
        }
    },function(err,results){
        if(err){
            console.log(err);
            console.log("unnormally");
            sendError(socket,err);
        }else{
            console.log("normally");
            let rsp_to_client = new protobuf.RspToClient();
            let search_user_res=new protobuf.SearchUser.Res();
            let user_info = new protobuf.People();
            user_info.setId(results.search_user[0].id);
            user_info.setName(results.search_user[0].name);
            user_info.setHeadpic(results.search_user[0].headpic);
            search_user_res.setUser(user_info);
            rsp_to_client.setSearchUserRes(search_user_res);
            let res_buf = utils.toBufferAndPrependLen(rsp_to_client);
            socket.write(res_buf);
        }
    });
}

module.exports=dealSearchUserReq;