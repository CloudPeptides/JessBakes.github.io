const BALLOT_CATEGORIES = ["bread", "cookie", "dessert"];

const CATEGORY_LABELS = {
    bread: "Bread",
    cookie: "Cookies",
    dessert: "Desserts"
};

const VOTE_STORAGE_KEY = "jess_bakes_ballot_voted";

let ballotOptions = [];
let votes = [];
let ballotSettings = null;

async function loadBallot() {
    await Promise.all([
        loadBallotSettings(),
        loadBallotOptions(),
        loadVotes(),
        loadHallOfFame()
    ]);

    renderStats();
    renderBallotCards();
    startCountdown();
}

async function loadBallotSettings() {
    const { data, error } = await supabaseClient
        .from("ballot_settings")
        .select("*")
        .eq("active", true)
        .limit(1)
        .single();

    if (error) {
        console.error("Error loading ballot settings:", error);
        return;
    }

    ballotSettings = data;
}

async function loadBallotOptions() {
    const { data, error } = await supabaseClient
        .from("ballot_options")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");

    if (error) {
        console.error("Error loading ballot options:", error);
        return;
    }

    ballotOptions = data || [];
}

async function loadVotes() {
    const { data, error } = await supabaseClient
        .from("votes")
        .select("*");

    if (error) {
        console.error("Error loading votes:", error);
        return;
    }

    votes = data || [];
}

async function loadHallOfFame() {
    const { data, error } = await supabaseClient
        .from("ballot_history")
        .select("*")
        .order("ended_at", { ascending: false })
        .limit(6);

    if (error) {
        console.error("Error loading hall of fame:", error);
        return;
    }

    renderHallOfFame(data || []);
}

function getVotesForOption(optionId) {
    return votes.filter((vote) => vote.option_id === optionId).length;
}

function getVotesForCategory(category) {
    return votes.filter((vote) => vote.category === category);
}

function getTotalVotes() {
    return votes.length;
}

function getCategoryOptions(category) {
    return ballotOptions.filter((option) => option.category === category);
}

function getCategoryLeader(category) {
    const options = getCategoryOptions(category);

    if (!options.length) {
        return null;
    }

    return options
        .map((option) => ({
            ...option,
            votes: getVotesForOption(option.id)
        }))
        .sort((a, b) => b.votes - a.votes)[0];
}

function renderStats() {
    const voteTotal = document.getElementById("voteTotal");
    const leaders = document.getElementById("leaders");

    if (voteTotal) {
        voteTotal.textContent = getTotalVotes();
    }

    if (leaders) {
        const leaderLines = BALLOT_CATEGORIES
            .map((category) => {
                const leader = getCategoryLeader(category);

                if (!leader) {
                    return `<p><strong>${CATEGORY_LABELS[category]}:</strong> No votes yet</p>`;
                }

                return `
                    <p>
                        <strong>${CATEGORY_LABELS[category]}</strong>
                        ${leader.name}
                    </p>
                `;
            })
            .join("");

        leaders.innerHTML = leaderLines;
    }
}

function renderBallotCards() {
    const container = document.getElementById("ballotContainer");

    if (!container) {
        return;
    }

    const hasVoted = localStorage.getItem(VOTE_STORAGE_KEY) === "true";

    const cards = BALLOT_CATEGORIES
        .map((category) => {
            const options = getCategoryOptions(category);

            if (!options.length) {
                return "";
            }

            return hasVoted
                ? renderResultsCard(category, options)
                : renderVotingCard(category, options);
        })
        .join("");

    container.innerHTML = `
        ${cards}

        <div class="submit-vote">
            ${
                hasVoted
                    ? `<p class="vote-message">Thanks for voting! Results update live as the community votes.</p>`
                    : `<button class="primary-btn" id="submitBallotVote">Submit Vote</button>`
            }
        </div>

        <div id="hallOfFame"></div>
    `;

    const submitButton = document.getElementById("submitBallotVote");

    if (submitButton) {
        submitButton.addEventListener("click", submitVote);
    }
}

function renderVotingCard(category, options) {
    return `
        <article class="ballot-card">
            <h3>${CATEGORY_LABELS[category]}</h3>
            <small>Choose one</small>

            <div class="ballot-options">
                ${options
                    .map(
                        (option) => `
                            <label class="ballot-option">
                                <input
                                    type="radio"
                                    name="${category}"
                                    value="${option.id}"
                                    data-category="${category}">
                                <span>${option.name}</span>
                            </label>
                        `
                    )
                    .join("")}
            </div>
        </article>
    `;
}

function renderResultsCard(category, options) {
    const categoryVotes = getVotesForCategory(category);
    const total = categoryVotes.length || 1;

    const results = options
        .map((option) => {
            const count = getVotesForOption(option.id);
            const percent = Math.round((count / total) * 100);

            return `
                <div class="result-row">
                    <div class="result-top">
                        <span>${option.name}</span>
                        <strong>${percent}%</strong>
                    </div>

                    <div class="result-bar">
                        <div class="result-fill" style="width:${percent}%"></div>
                    </div>

                    <small>${count} vote${count === 1 ? "" : "s"}</small>
                </div>
            `;
        })
        .join("");

    return `
        <article class="ballot-card">
            <h3>${CATEGORY_LABELS[category]}</h3>
            <small>Current results</small>
            ${results}
        </article>
    `;
}

async function submitVote() {
    const selectedVotes = BALLOT_CATEGORIES
        .map((category) => {
            const selected = document.querySelector(`input[name="${category}"]:checked`);

            if (!selected) {
                return null;
            }

            return {
                option_id: selected.value,
                category: selected.dataset.category,
                voter_hash: getVoterHash()
            };
        })
        .filter(Boolean);

    if (selectedVotes.length !== BALLOT_CATEGORIES.length) {
        alert("Please choose one option in each category before submitting your vote.");
        return;
    }

    const { error } = await supabaseClient
        .from("votes")
        .insert(selectedVotes);

    if (error) {
        console.error("Error submitting vote:", error);
        alert("Something went wrong while submitting your vote. Please try again.");
        return;
    }

    localStorage.setItem(VOTE_STORAGE_KEY, "true");

    await loadVotes();

    renderStats();
    renderBallotCards();
}

function getVoterHash() {
    let voterId = localStorage.getItem("jess_bakes_voter_id");

    if (!voterId) {
        voterId = crypto.randomUUID();
        localStorage.setItem("jess_bakes_voter_id", voterId);
    }

    return voterId;
}

function startCountdown() {
    const countdown = document.getElementById("countdown");

    if (!countdown || !ballotSettings || !ballotSettings.end_date) {
        return;
    }

    function updateCountdown() {
        const endDate = new Date(ballotSettings.end_date);
        const now = new Date();
        const difference = endDate - now;

        if (difference <= 0) {
            countdown.textContent = "Voting Closed";
            return;
        }

        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((difference / (1000 * 60)) % 60);

        countdown.textContent = `${days}d ${hours}h ${minutes}m`;
    }

    updateCountdown();
    setInterval(updateCountdown, 60000);
}

function renderHallOfFame(historyItems) {
    const hall = document.getElementById("hallOfFame");

    if (!hall) {
        return;
    }

    if (!historyItems.length) {
        hall.innerHTML = "";
        return;
    }

    hall.innerHTML = `
        <section class="hall-of-fame">
            <p class="eyebrow">Past Winners</p>
            <h2>Hall of Fame</h2>

            <div class="hall-grid">
                ${historyItems
                    .map(
                        (item) => `
                            <article class="hall-card">
                                <small>${item.category}</small>
                                <h3>${item.winner}</h3>
                                <p>${item.votes} votes</p>
                            </article>
                        `
                    )
                    .join("")}
            </div>
        </section>
    `;
}

loadBallot();
