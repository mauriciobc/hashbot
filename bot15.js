require('dotenv').config();
// const moment = require('moment'); Using moment-timezone to select preferred timezone
const moment = require('moment-timezone');
const preferredTimezone = 'America/Sao_Paulo';
const Mastodon = require('mastodon-api');
const readline = require('readline');

const M = new Mastodon({
    client_key: process.env.CLIENT_KEY,
    client_secret: process.env.CLIENT_SECRET,
    access_token: process.env.ACCESS_TOKEN,
    timeout_ms: 60 * 1000,
    api_url: process.env.MASTODON_URL,
});

const hashtags = [
    'almocodedomingo',
    'segundaficha',
    'tercinema',
    'quartacapa',
    'musiquinta',
    'sextaserie',
    'caturday',
];

const ignoredAccounts = ['TagsBR','TrendsBR','trending'];

const todayTimestamp = moment().startOf('day').unix();
console.log(moment.unix(todayTimestamp).tz(preferredTimezone).format('YYYY-MM-DD'));

// Function to calculate the relevance score based on favorites, boosts, and followers
async function calculateRelevance(toot) {
    if (!toot || !toot.account || !toot.account.id) {
        console.warn('Ignorando toot sem informações sobre conta:', toot);
        return null;
    }

    try {
        const w_F = 0.4; // Weight for favorites
        const w_B = 0.3; // Weight for boosts
        const w_N = 0.3; // Weight for followers
        const relevanceScore = Math.round((w_F * toot.favourites_count + w_B * toot.reblogs_count + w_N * (toot.account.followers_count || 0)) * 10) / 10;
        // Log 
        // console.log(toot.favourites_count, toot.reblogs_count, (toot.account.followers_count || 0), relevanceScore);
        const result = {
            ...toot,
            relevanceScore,
        };
        //console.log(result);
        return result;
    } catch (error) {
        console.error(`Erro ao calcular a pontuação de relevância para o toot ${toot.id || 'unknown'}:`, error);
        return null;
    }
}

// Function to sort toots by relevance
async function sortTootsByRelevance(toots) {
    const relevanceScores = await Promise.all(toots.map(calculateRelevance));
    return relevanceScores.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// Function to fetch toots for the current day and log progress
async function fetchToots(hashtag) {
    try {
        let toots = [];
        let maxId = null;
        let progress = 0;
        console.log(`Obtendo posts para ${hashtag} ...`);

        while (true) {
            const params = {
                tag: hashtag,
                limit: 40,
            };
            if (maxId) {
                params.max_id = maxId;
            }

            const response = await fetchTootsFromAPI(hashtag, params);
            if (!Array.isArray(response.data)) {
                console.error('Erro ao obeter posts:', response);
                break;
            }

            const newToots = response.data.filter(toot => toot && moment(toot.created_at).unix() >= todayTimestamp);
            toots.push(...newToots);

            maxId = newToots[newToots.length - 1]?.id;
            progress += newToots.length;

            if (newToots.length < 40) {
                break;
            }
        }

        console.log(`Posts obtidos: ${toots.length}`);
        console.log(`Progresso: ${progress} / ${toots.length}`);
        //console.log(toots)
        return toots;
    } catch (error) {
        console.error('Erro ao obter posts:', error);
        throw error;
    }
}

async function fetchTootsFromAPI(hashtag, params) {
    const url = `timelines/tag/${hashtag}`;
    console.log(`Buscando ${url}...`);
    const response = await M.get(url, params);
    return response;
}

// Filter only toots from the current day
function filterTootsByDate(toots, date) {
    return toots.filter(toot => moment(toot.created_at).isSame(date, 'day'));
}

// Function to get hashtag usasge for the current day
async function getHashtagUse(hashtag) {
    try {
        const response = await M.get(`tags/${hashtag}`);
        //console.table(response.data.history);
        return response.data.history;
    } catch (error) {
        console.error(`Erro ao obter dados de uso da hashtag para ${hashtag}:`, error);
        return [];
    }
}

const generateTootLink = (tootId) => `https://ursal.zone/web/statuses/${tootId}`;

const generateTootText = async (hashtag, toots) => {
    if (!hashtag || !toots || toots.length === 0) return null;

    const topToots = toots.slice(0, 5);
    const [history, topTootDetails] = await Promise.all([
        getHashtagUse(hashtag).then(result => result?.[0]),
        Promise.all(topToots.map(({
            account = { username: '(unknown username)', followers_count: 0 },
            favourites_count = 0,
            reblogs_count = 0,
            relevanceScore = 0,
            id,
        }) => [
            account.username,
            account.followers_count,
            favourites_count,
            reblogs_count,
            relevanceScore,
            generateTootLink(id),
        ]))
    ]);
    
    const hist = await getHashtagUse(hashtag);
    const historicUses = await calculateSumOfUses(hist);

    const tootText = [
        `Tag do dia: #${hashtag}\n\n`,
        `Uso da tag na semana: ${historicUses}\n`,
        `Participantes: ${history?.accounts || 'unknown'}\n`,
        `Posts hoje: ${history?.uses || 'unknown'}\n\n`,
        `Principais posts de hoje:\n\n`,
        ...topTootDetails.map(([
            account, followers_count, favourites_count, reblogs_count, relevanceScore, link
        ], i) => [
            `Publicado por ${account}\n`,
            `Seguidores: ${followers_count}\n`,
            `⭐ ${favourites_count} `,
            `🔄 ${reblogs_count} `,
            `📈 ${relevanceScore}\n`,
            `🔗 ${link}\n\n`,
        ].join('')),
    ].join('');

    console.log(tootText);
    return tootText;
}

// Function to calculate sum of uses in history object
async function calculateSumOfUses(hist) {
    if (!hist) {
        return 0;
    }

    let totalUses = 0;

    for (const entry of hist) {
        if (entry && entry.uses) {
            totalUses += parseInt(entry.uses);
        }
    }

    return totalUses;
}

// Function to sort toots by relevance
async function sortTootsByRelevance(toots) {
    return Promise.all(toots.map(calculateRelevance))
        .then(relevanceScores => relevanceScores.sort((a, b) => b.relevanceScore - a.relevanceScore));
}

// Function to remove toots from ignored accounts
async function removeIgnoredToots(toots) {
    return toots.filter(toot => !ignoredAccounts.includes(toot.account.username));
}

// Function to create toot
async function createToot(tootText) {
    console.log('Entering createToot function');
    console.log('tootText:', tootText, tootText.length);
  
    if (typeof tootText !== 'string') {
      throw new Error('Toot text must be a string');
    }
  
    if (tootText.trim() === '') {
      throw new Error('Toot text cannot be empty');
    }
  
    try {
      console.log('Attempting to create toot');
      const response = await M.post('statuses', {
        status: tootText,
        sensitive: false,
        visibility: 'public',
        language: 'pt',
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
        },
      });
      
      //console.log('Toot created successfully!');
      //console.log('Toot response:', response);
      //console.log('Toot details:', response.data);
      if (!response || !response.data) {
        throw new Error('Invalid response data from Mastodon API');
      }
  
      
    } catch (error) {
      console.error('Error creating toot:', error);
      throw error;
    }
  
    console.log('Exiting createToot function');
  }
  
  
// Main function to fetch, process, and print toots
async function main() {
    const hashtag = hashtags[new Date().getDay()];
    const currentDate = new Date().toISOString().split('T')[0];
    const toots = await fetchToots(hashtag);
    const sortedToots = await sortTootsByRelevance(toots);
    console.log(`Retrieved ${toots.length} toots`);
    const allowedToots = await removeIgnoredToots(sortedToots);
    const todaysToots = await filterTootsByDate(allowedToots, currentDate);
    const tootText = await generateTootText(hashtag, todaysToots);

    const answer = await new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question('Do you want to toot? (y/n) ', answer => {
            rl.close();
            resolve(answer);
        });
    });

    if (answer.toLowerCase() === 'y') {
        console.log(tootText);
        await createToot(tootText);
    }
}   

main();