const protobuf=require("./test_pb");
const utils=require("./utils");
const sendError=require("./dealError");
const err_types=protobuf.Error.Error_type;
function dealRegisterReq(socket,req_to_server,mysql_client){
    let register_req=req_to_server.getRegisterReq();
    let name=register_req.getName();
    let password=register_req.getPassword();
    let headpic=register_req.getHeadpic();
    let new_user = {name:name,password:password,headpic:headpic};
    mysql_client.query('INSERT INTO userinfo SET ?',new_user,
        function (error, results, fields) {
            let rsp_buf;
            if (error) {
                console.log(error);
                sendError(socket,err_types.UNKNOWN_REG_ERR);

            }else{
                let id=results.insertId;
                let rsp_to_client=new protobuf.RspToClient();
                let register_res=new protobuf.Register.Res();
                register_res.setId(id);
                rsp_to_client.setRegisterRes(register_res);
                rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
                socket.on("error",function(error){
                    mysql_client.query('delete from userinfo where id = ?',id,(err)=>{
                        if(err){
                            console.log(err);//之后查文档来进行错误处理！！！！！！！！！！！！！！！！！
                        }
                    })
                });
                socket.write(rsp_buf);
            }
        }
    );
}

module.exports=dealRegisterReq;