
const md5 = require('md5-node');
let date;
var utils={
    ip_str_to_num:function(str){
        let x;
        let y;
        let z;
    
        for(let i = 0;i<str.length;i++){
            if(str[i]==='.'){
                if(x===undefined){
                    x = i;
                }else if(y===undefined){
                    y = i;
                }else if(z===undefined){
                    z = i;
                }
            }
        }
        let num1 = parseInt(str.slice(0,x));
        let num2 = parseInt(str.slice(x+1,y));
        let num3 = parseInt(str.slice(y+1,z));
        let num4 = parseInt(str.slice(z+1,str.length));
        return ((num1<<24)>>>0)+((num2<<16)>>>0)+((num3<<8)>>>0)+((num4)>>>0);
    },
    ip_num_to_str:function(num){
        let a = num>>>24
        let b = (num>>>16)&255;
        let c = (num>>>8)&255;
        let d = num&255;
        return a+'.'+b+'.'+c+'.'+d;
    },
    toBufferAndPrependLen:function(message){
        //将message对象转化成buffer
        let msg_buf=Buffer.from(message.serializeBinary());
        let len=msg_buf.length;
        let len_buf=Buffer.alloc(4);
        len_buf.writeUInt32BE(len);
        //在buffer前端添加长度。
        msg_buf=Buffer.concat([len_buf,msg_buf]);
        return msg_buf;
    },
    generate_long_token :function(id,password){
        //获取时间
        date = new Date();
        return id + md5(id+password+date.getTime()+Math.random());
    },
    generate_short_token : function(id,password){
        date = new Date();
        return id + md5(password+id+date.getTime()+Math.random());
    }    
};

// let ip="139.199.102.166";
// let num=utils.ip_str_to_num(ip);
// console.log(num);
// let ip1=utils.ip_num_to_str(num);
// console.log(ip1);
//console.log(utils.generate_long_token(10012,"mylovezsy"));
module.exports=utils;
