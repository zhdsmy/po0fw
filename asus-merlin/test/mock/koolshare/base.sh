export PATH=/mock/bin:$PATH
http_response() { echo "RESP $*" >>/state/resp.log; }
