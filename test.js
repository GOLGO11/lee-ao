function createTopDiv() {

    var newDiv = document.createElement('div');


    newDiv.style.position = 'absolute';


    newDiv.style.zIndex = 1000;


    newDiv.style.width = '200px';


    newDiv.style.height = '200px';


    newDiv.style.backgroundColor = 'orange';


    document.body.appendChild(newDiv);


}


// 使用


createTopDiv();