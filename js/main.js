const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const uploadIcon = document.querySelector(".upload-icon");
const uploadTitle = document.querySelector(".upload-title");
const uploadText = document.querySelector(".upload-text");
const analyzeBtn = document.getElementById("analyze-btn")
const loading = document.getElementById("loading");
const progress = document.querySelector(".progress");
const loadingText = document.getElementById("loading-text");
const fadeElements = document.querySelectorAll(".fade-up");
const overallScore = document.getElementById("overall-score");
const reportSection = document.querySelector(".advanced-report");
const questions = document.querySelectorAll(".faq-question");

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

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;

        reader.readAsDataURL(file);
    });
}

analyzeBtn.addEventListener("click", async function(){
    const loading = document.getElementById("loading");
    const file = imageInput.files[0];

    if (!file){
        return;
    }

    loading.style.display = "block";
    
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "analyzing...";

    const imageData = await fileToDataURL(file);

    let percent = 0;

    const progress = document.querySelector(".progress")
    const interval = setInterval(function(){

        percent ++;

        progress.style.width = percent + "%";
        loadingText.textContent = percent + "%";

        
        if (percent >= 100) {

            clearInterval(interval);

            setTimeout(async function() {

            
                try {

                    const imageData = await fileToDataURL(file);

                    const result = await analyzeImage(imageData);

                    console.log("AI RESULT:", result);

                } catch (error) {

                    console.error("AI ERROR:", error);

                }


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

                analyzeBtn.textContent = "Analyze My Face";

            }, 1500);


        } else if (percent < 20) {

            loadingText.textContent =
                "📷 Reading image... " + percent + "%";


        } else if (percent < 45) {

            loadingText.textContent =
                "🔍 Detecting facial landmarks... " + percent + "%";


        } else if (percent < 75) {

            loadingText.textContent =
                "📐 Measuring facial symmetry... " + percent + "%";


        } else {

            loadingText.textContent =
                "🧠 Generating AI report... " + percent + "%";

        }

    }, 40);

});


window.addEventListener("load", function(){
    
    fadeElements.forEach(function(element, index){

        setTimeout(function(){

            element.classList.add("show");

        }, index * 250);

    });
});


function startCounter(){

    let score = 0;

    const scoreInterval = setInterval(function(){

    score += 0.1;

    overallScore.textContent = score.toFixed(1) + " / 10";

    if(score >= 9.4){

        clearInterval(scoreInterval);
        overallScore.textContent = "9.4 / 10";

    }

},30);
}

const observer = new IntersectionObserver(function(entries){

    if(entries[0].isIntersecting){

        startCounter();
        observer.disconnect();
    }
});

observer.observe(reportSection);

questions.forEach(function(question){

    question.addEventListener("click",function(){

        const answer = this.nextElementSibling;

        if(answer.style.maxHeight){
            
            answer.style.maxHeight = null;
        }else{

            answer.style.maxHeight =
            answer.scrollHeight + "px";
        }
    })
})

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;

        reader.readAsDataURL(file);
    });
}


