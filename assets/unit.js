/**
  展开与隐藏 + 向下展开
*/
export function unfoldAdd(arr) {
    for(var i=0;i<arr.length;i++){
      arr[i].setAttribute('index',0);
      if(arr[0].getAttribute('data-index-open') == 'true'){
        arr[0].nextElementSibling.style.opacity = 1;
        arr[0].nextElementSibling.style.height = arr[0].nextElementSibling.scrollHeight + 'px';
        arr[0].querySelector(".unfold-arrow div:nth-child(1)").style.transform="translate(-50%, -50%) rotate(180deg)";
        arr[0].querySelector(".unfold-arrow div:nth-child(2)").style.opacity=0;
        arr[0].setAttribute('index',1);
      }
      arr[i].addEventListener('click',function(){
        if(this.getAttribute('index') == 0){
          this.nextElementSibling.style.opacity = 1;
          this.nextElementSibling.style.height = this.nextElementSibling.scrollHeight + 'px';
          
          this.querySelector(".unfold-arrow div:nth-child(1)").style.transform="translate(-50%, -50%) rotate(180deg)";
          this.querySelector(".unfold-arrow div:nth-child(2)").style.opacity=0;
          this.setAttribute('index',1);
        }else{
          this.nextElementSibling.style.opacity = 0;
          this.nextElementSibling.style.height = '0px';
          this.querySelector(".unfold-arrow div:nth-child(1)").style.transform="translate(-50%, -50%) rotate(0deg)";
          this.querySelector(".unfold-arrow div:nth-child(2)").style.opacity=1;
          this.setAttribute('index',0);
        }
      })
    }
}
/**
  展开与隐藏  方向箭头 (单击当前展开，其他兄弟关闭)
  1.arr数组
*/
export function unfoldArrow(arr) {
      for(var i=0;i<arr.length;i++){
        arr[i].setAttribute('index',0);
        // arr[0].nextElementSibling.style.height = arr[0].nextElementSibling.scrollHeight + 'px';
        // arr[0].querySelector("svg").style.transform=`rotate(${arr[0].getAttribute('data-deg')}deg)`;
        if(arr[0].getAttribute('data-index-open')== 'true'){
          arr[0].nextElementSibling.style.height = arr[0].nextElementSibling.scrollHeight + 'px';
          arr[0].querySelector("svg").style.transform=`rotate(${arr[0].getAttribute('data-deg')}deg)`;
          arr[0].setAttribute('index',1);
        }
        arr[i].addEventListener('click',function(){
           if(this.getAttribute('index') == 0){
            // for(var j=0;j<arr.length;j++){
            //   arr[j].nextElementSibling.style.height = '0px';
            //   arr[j].querySelector("svg").style.transform="rotate(0deg)";
            //   this.setAttribute('index',0);
            // }
            this.nextElementSibling.style.height = this.nextElementSibling.scrollHeight + 'px';
            this.querySelector("svg").style.transform=`rotate(${this.getAttribute('data-deg')}deg)`;
            this.setAttribute('index',1);
           }else{
             this.nextElementSibling.style.height = '0px';
             this.querySelector("svg").style.transform="rotate(0deg)";
             this.setAttribute('index',0);
           }
        })
      }
}
