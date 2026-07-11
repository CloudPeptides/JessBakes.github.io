document
.getElementById("suggestionForm")
.addEventListener("submit", submitSuggestion);

async function submitSuggestion(e){

    e.preventDefault();

    const category =
        suggestionCategory.value;

    const suggestion =
        suggestionText.value.trim();

    const customer_name =
        suggestionName.value.trim();

    const { data: existing } =
        await supabaseClient

        .from("suggestions")

        .select("*")

        .ilike("suggestion", suggestion)

        .eq("category", category)

        .maybeSingle();

    if(existing){

        await supabaseClient

        .from("suggestions")

        .update({

            times_requested:
                existing.times_requested + 1

        })

        .eq("id", existing.id);

    }

    else{

        await supabaseClient

        .from("suggestions")

        .insert({

            category,

            suggestion,

            customer_name

        });

    }

    alert("Thank you! Your suggestion has been submitted.");

    suggestionForm.reset();

}
