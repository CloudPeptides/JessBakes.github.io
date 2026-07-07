async function loadBallot() {

   const { data, error } = await supabaseClient
        .from("ballot_options")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");

    if (error) {
        console.error(error);
        return;
    }

    console.log(data);

}

loadBallot();
