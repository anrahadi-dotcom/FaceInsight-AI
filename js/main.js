
const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadIcon = document.querySelector(".upload-icon");
const uploadTitle = document.querySelector(".upload-title");
const uploadText = document.querySelector(".upload-text");

imageInput.addEventListener("change", function(){

    const file = imageInput.files[0];

    if(file){

    preview.src = URL.createObjectURL(file);

    preview.style.display = "block";
    uploadIcon.style.display = "none";
    uploadTitle.style.display = "none";
    uploadText.style.display = "none";

    }

});


