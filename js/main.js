const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadIcon = document.querySelector(".upload-icon");
const uploadTitle = document.querySelector(".upload-title");
const uploadText = document.querySelector(".upload-text");
const analyzeBtn = document.getElementById("analyze-btn")
const loading = document.getElementById("loading");
const progress = document.querySelector(".progress");
const loadingText = document.getElementById("loading-text");


imageInput.addEventListener("change", function(){

    const file = imageInput.files[0];

    if(file){

    preview.src = URL.createObjectURL(file);

    preview.style.display = "block";
    analyzeBtn.style.display = "block";
    uploadIcon.style.display = "none";
    uploadTitle.style.display = "none";
    uploadText.style.display = "none";

    }

});

analyzeBtn.addEventListener("click", function(){
    const loading = document.getElementById("loading");

    loading.style.display = "block";
    
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "analyzing...";

    let percent = 0;

    const progress = document.querySelector(".progress")
    const interval = setInterval(function(){

        percent ++;

        progress.style.width = percent + "%";
        loadingText.textContent = percent + "%";

        
        if (percent >=100){

            clearInterval(interval);

            setTimeout(function(){

                loading.style.display = "none";

                progress.style.width = "0%";
                loadingText.textContent = "0%";

                preview.src = "";
                preview.style.display = "none";

                analyzeBtn.style.display = "none";
                analyzeBtn.disabled = false;

                uploadIcon.style.display = "block";
                uploadTitle.style.display = "block";
                uploadText.style.display = "block";

                imageInput.value = "";

                analyzeBtn.textContent = "Analyze My Face"

            }, 1500);

            loadingText.textContent = "✅ Analysis Complete!";

            analyzeBtn.disabled = false;
        }else if(percent <20){

            loadingText.textContent = "📷 Reading image..." + percent + "%";
        }else if(percent >25){

            loadingText.textContent = "🔍 Detecting facial landmarks..." + percent + "%";
        }else if(percent <45){

            loadingText.textContent = "📐 Measuring facial symmetry..." + percent + "%";
        }else if(percent >75){

            loadingText.textContent = "🧠 Generating AI report..."; + percent + "%";
        }

    },40);

 

});


