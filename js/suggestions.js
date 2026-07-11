document
.getElementById("suggestionForm")
.addEventListener("submit", submitSuggestion);

document
    .getElementById("suggestionForm")
    .addEventListener("submit", submitSuggestion);

async function submitSuggestion(e) {

    e.preventDefault();

    const category = suggestionCategory.value;
    const suggestion = suggestionText.value.trim();
    const customer_name = suggestionName.value.trim();

    const { error } = await supabaseClient
        .from("suggestions")
        .insert({
            category,
            suggestion,
            customer_name
        });

    if (error) {
        console.error(error);
        alert(error.message);
        return;
    }

    alert("Thank you! Your suggestion has been submitted.");

    suggestionForm.reset();

}
