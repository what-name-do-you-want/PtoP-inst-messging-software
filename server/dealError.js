const protobuf=require("./test_pb");
const utils=require("./utils");
function sendError(socket,error_type){
    let rsp_to_client=new protobuf.RspToClient();
    let error=new protobuf.Error();
    error.setErrorType(error_type);
    rsp_to_client.setError(error);
    rsp_buf=utils.toBufferAndPrependLen(rsp_to_client);
    socket.write(rsp_buf);
}

module.exports=sendError;