async function loadBallot() {

    const { data, error } = await supabase
        .from("ballot_options")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");

    console.log(data);

}

loadBallot();
