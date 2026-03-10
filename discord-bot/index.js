// ================================================================
// WSP-MDT COMPLETE BOT - Połączony system
// ================================================================
// Ten bot łączy:
// 1. Stary system: sync członków + zarządzanie prawami jazdy
// 2. Nowy system: Discord Economy (dowody, pojazdy, OC, sprzedaż)
// 3. Komenda !allinfo @user (wszystkie dane użytkownika)
// ================================================================

const { Client, GatewayIntentBits, Partials, ActivityType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// ================================================================
// KONFIGURACJA
// ================================================================

const CONFIG = {
    // Discord Bot Token (ze starego bota)
    DISCORD_TOKEN: 'MTQxMTI2OTA5NDUyNjY4MTExOQ.G3BTaP.xbjfpCqwtSRIAq2LuvP9vgJOON-GzmniNxt3I4',
    
    // Server Info
    GUILD_ID: '1202645184735613029',
    LOG_CHANNEL_ID: '1423690747294519448',
    NO_LICENSE_ROLE_ID: '1253431189314998405',
    
    // Kanały Discord Economy (ZMIEŃ NA SWOJE!)
    CHANNELS: {
        CITIZEN_ID: '1234567890123456789',        // Kanał dowodów
        VEHICLE_PURCHASE: '9876543210987654321',  // Kanał kupna pojazdów
        VEHICLE_INSURANCE: '1111111111111111111', // Kanał OC
        VEHICLE_SALE: '2222222222222222222'       // Kanał sprzedaży
    },
    
    // MDT API
    SYNC_API_URL: 'http://217.160.0.153:3000/api/sync-citizens',  // Stary endpoint (sync członków)
    MDT_API_URL: 'http://217.160.0.153:3000',                      // Nowy endpoint (economy)
    MDT_API_KEY: 'aca60759-2eec-46e9-98a1-a3cd05e2c3cb',      // Klucz API dla economy
    
    // Ścieżki do plików
    SUSPENDED_LICENSES_FILE: path.join(__dirname, '../db_suspended_licenses.json'),
    
    // Auto-sync
    SYNC_MEMBERS_ENABLED: true,
    SYNC_MEMBERS_INTERVAL_HOURS: 1,
    CHECK_SUSPENSIONS_INTERVAL_SECONDS: 15,
    ECONOMY_SYNC_ENABLED: true,
    ECONOMY_SYNC_INTERVAL_HOURS: 1
};

// ================================================================
// INICJALIZACJA BOTA
// ================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Message,
        Partials.Reaction
    ]
});

// ================================================================
// STARY SYSTEM - SYNCHRONIZACJA CZŁONKÓW
// ================================================================

/**
 * Synchronizacja członków z MDT
 */
async function runMembersSync(guild, feedbackChannel = null) {
    if (!guild) {
        console.error("[MEMBERS SYNC] Błąd: Brak obiektu serwera.");
        return;
    }

    let logChannel = feedbackChannel;
    if (!logChannel) {
        try {
            logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL_ID);
        } catch (err) {
            console.error(`[MEMBERS SYNC] Nie udało się pobrać kanału logów: ${CONFIG.LOG_CHANNEL_ID}`, err);
            logChannel = null;
        }
    }

    try {
        if (feedbackChannel) {
            await feedbackChannel.send('[WSP-MDT] 🔄 Rozpoczynam synchronizację członków...');
        } else {
            console.log(`[MEMBERS SYNC] Rozpoczynam automatyczną synchronizację dla ${guild.name}...`);
        }

        // Pobierz wszystkich członków
        const allMembers = await guild.members.fetch();
        const memberMap = new Map();
        allMembers.forEach(member => memberMap.set(member.id, member));

        // Dodaj właściciela
        try {
            const owner = await guild.members.fetch(guild.ownerId);
            if (owner) memberMap.set(owner.id, owner);
        } catch (err) {
            console.error("[MEMBERS SYNC] Nie udało się pobrać właściciela serwera.", err);
        }
        
        // Przygotuj dane
        const membersData = [...memberMap.values()].map(m => ({
            discordId: m.id,
            name: m.displayName,
        }));

        // Wyślij do API
        const response = await fetch(CONFIG.SYNC_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(membersData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Błąd API: ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        const successMessage = `[WSP-MDT] ✅ Pomyślnie zsynchronizowano ${result.syncedCount} członków.`;
        
        if (result.success) {
            if (logChannel && logChannel.id !== feedbackChannel?.id) {
                await logChannel.send(successMessage);
            } else if (feedbackChannel) {
                await feedbackChannel.send(successMessage);
            }
            console.log(`[MEMBERS SYNC] Synchronizacja zakończona pomyślnie. Zsynchronizowano: ${result.syncedCount}`);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('[MEMBERS SYNC] Błąd podczas synchronizacji:', error);
        if (logChannel) {
            await logChannel.send(`[WSP-MDT] ❌ Wystąpił błąd podczas synchronizacji: ${error.message}`);
        }
    }
}

// ================================================================
// STARY SYSTEM - ZARZĄDZANIE ROLĄ "BRAK PRAWA JAZDY"
// ================================================================

/**
 * Sprawdzanie i zarządzanie zawieszonymi prawami jazdy
 */
async function checkSuspendedLicenses(guild) {
    if (!guild) {
        console.error("[SUSPENDED] Brak obiektu serwera. Pomijam sprawdzanie.");
        return;
    }

    try {
        // Sprawdź czy plik istnieje
        if (!fs.existsSync(CONFIG.SUSPENDED_LICENSES_FILE)) {
            return;
        }

        const fileContent = fs.readFileSync(CONFIG.SUSPENDED_LICENSES_FILE, 'utf-8');
        if (!fileContent.trim()) return;

        let suspensions = JSON.parse(fileContent);
        const now = new Date();
        let dataWasChanged = false;
        const activeSuspensions = [];

        for (const suspension of suspensions) {
            // Sprawdź czy zawieszenie wygasło
            if (new Date(suspension.expiresAt) <= now) {
                console.log(`[SUSPENDED] Wygasło zawieszenie dla ID: ${suspension.citizenId}. Zdejmuję rolę.`);
                try {
                    const member = await guild.members.fetch(suspension.citizenId);
                    if (member.roles.cache.has(CONFIG.NO_LICENSE_ROLE_ID)) {
                        await member.roles.remove(CONFIG.NO_LICENSE_ROLE_ID);
                        console.log(`[SUSPENDED] Zdjęto rolę: ${member.user.tag}`);
                    }
                } catch (error) {
                    if (error.code !== 10007) {
                        console.error(`[SUSPENDED] Nie udało się zdjąć roli dla ID ${suspension.citizenId}.`, error.message);
                    }
                }
                dataWasChanged = true;
                continue;
            }

            // Nadaj rolę dla nowych zawieszeń
            if (!suspension.roleAssigned) {
                console.log(`[SUSPENDED] Nowe zawieszenie dla ID: ${suspension.citizenId}. Nadaję rolę.`);
                try {
                    const member = await guild.members.fetch(suspension.citizenId);
                    await member.roles.add(CONFIG.NO_LICENSE_ROLE_ID);
                    suspension.roleAssigned = true;
                    dataWasChanged = true;
                    console.log(`[SUSPENDED] Nadano rolę: ${member.user.tag}`);
                } catch (error) {
                    if (error.code !== 10007) {
                        console.error(`[SUSPENDED] Nie udało się nadać roli dla ID ${suspension.citizenId}.`, error.message);
                    }
                }
            }
            
            activeSuspensions.push(suspension);
        }

        // Zapisz zmiany
        if (dataWasChanged) {
            fs.writeFileSync(CONFIG.SUSPENDED_LICENSES_FILE, JSON.stringify(activeSuspensions, null, 2));
            console.log(`[SUSPENDED] Zaktualizowano plik zawieszeń.`);
        }
    } catch (error) {
        console.error("[SUSPENDED] Wystąpił błąd podczas sprawdzania zawieszeń:", error);
    }
}

// ================================================================
// NOWY SYSTEM - PARSERY DISCORD ECONOMY
// ================================================================

/**
 * Parser dla dowodu osobistego
 */
function parseCitizenID(content, author, messageId) {
    const patterns = {
        firstName: /Imię:\s*(.+)/i,
        lastName: /Nazwisko:\s*(.+)/i,
        age: /Wiek:\s*(\d+)/i,
        dateOfBirth: /Data urodzenia:\s*(.+)/i,
        countryOfOrigin: /Kraj pochodzenia:\s*(.+)/i,
        cityOfOrigin: /Miasto z którego pochodzi:\s*(.+)/i,
        history: /Historia postaci:\s*(.+)/i,
        gender: /Płeć:\s*(.+)/i,
        robloxNick: /Nick w roblox:\s*(.+)/i
    };
    
    const data = { messageId, discordId: author.id, discordTag: author.tag };
    
    for (const [key, regex] of Object.entries(patterns)) {
        const match = content.match(regex);
        if (match) {
            data[key] = match[1].trim();
        }
    }
    
    const required = ['firstName', 'lastName', 'age', 'gender', 'robloxNick'];
    const hasAllRequired = required.every(field => data[field]);
    
    if (!hasAllRequired) return null;
    
    data.approved = false;
    data.submittedAt = new Date().toISOString();
    
    return data;
}

/**
 * Parser dla kupna pojazdu
 */
function parseVehiclePurchase(content, author, messageId) {
    const patterns = {
        brand: /Marka Pojazdu:\s*(.+)/i,
        year: /Rocznik Pojazdu:\s*(\d+)/i,
        model: /Model:\s*(.+)/i,
        trim: /Trim:\s*(.+)/i,
        plate: /Tablice Rejestracyjne:\s*(.+)/i,
        plateState: /Stan Tablic:\s*(.+)/i,
        gamepass: /Gamepass:\s*(.+)/i,
        owners: /Właściciel\/e:\s*(.+)/i,
        drivers: /Kierowca\/y:\s*(.+)/i,
        price: /Cena Pojazdu:\s*([\d,]+)/i,
        color: /Kolor Pojazdu:\s*(.+)/i,
        photo: /Zdjęcie Pojazdu:\s*(.+)/i
    };
    
    const data = { messageId, discordId: author.id, discordTag: author.tag };
    
    for (const [key, regex] of Object.entries(patterns)) {
        const match = content.match(regex);
        if (match) {
            let value = match[1].trim();
            
            if (key === 'owners' || key === 'drivers') {
                value = value.split(/[,\n]/).map(x => x.trim()).filter(x => x);
            } else if (key === 'price') {
                value = parseInt(value.replace(/,/g, ''));
            }
            
            data[key] = value;
        }
    }
    
    const required = ['brand', 'year', 'model', 'plate', 'owners'];
    const hasAllRequired = required.every(field => data[field]);
    
    if (!hasAllRequired) return null;
    
    data.approved = false;
    data.submittedAt = new Date().toISOString();
    data.vehicleId = `VEH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return data;
}

/**
 * Parser dla ubezpieczenia OC
 */
function parseInsurance(content, author, messageId) {
    const patterns = {
        brand: /Marka Pojazdu:\s*(.+)/i,
        year: /Rocznik Pojazdu:\s*(\d+)/i,
        model: /Model:\s*(.+)/i,
        trim: /Trim:\s*(.+)/i,
        owners: /Właściciel\/e:\s*(.+)/i,
        plateAndState: /Tablice Rejestracyjne \/ Stan :\s*(.+)/i,
        vehiclePrice: /Cena Pojazdu:\s*([\d,]+)/i,
        insurancePrice: /Cena Ubezpieczenia:\s*([\d,]+)/i,
        photo: /Zdjęcie Pojazdu:\s*(.+)/i
    };
    
    const data = { messageId, discordId: author.id, discordTag: author.tag };
    
    for (const [key, regex] of Object.entries(patterns)) {
        const match = content.match(regex);
        if (match) {
            let value = match[1].trim();
            
            if (key === 'owners') {
                value = value.split(/[,\n]/).map(x => x.trim()).filter(x => x);
            } else if (key === 'vehiclePrice' || key === 'insurancePrice') {
                value = parseInt(value.replace(/,/g, ''));
            } else if (key === 'plateAndState') {
                const parts = value.split('/').map(x => x.trim());
                data.plate = parts[0] || '';
                data.plateState = parts[1] || '';
                continue;
            }
            
            data[key] = value;
        }
    }
    
    const required = ['brand', 'plate', 'owners'];
    const hasAllRequired = required.every(field => data[field]);
    
    if (!hasAllRequired) return null;
    
    data.approved = false;
    data.submittedAt = new Date().toISOString();
    data.insuranceId = `INS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    data.expiryDate = expiryDate.toISOString();
    
    return data;
}

/**
 * Parser dla sprzedaży pojazdu
 */
function parseVehicleSale(content, author, messageId) {
    const patterns = {
        brand: /Marka Pojazdu:\s*(.+)/i,
        year: /Rocznik Pojazdu:\s*(\d+)/i,
        model: /Model:\s*(.+)/i,
        trim: /Trim:\s*(.+)/i,
        color: /Kolor Pojazdu:\s*(.+)/i,
        condition: /Stan Techniczny Pojazdu:\s*(.+)/i,
        history: /Historia Pojazdu:\s*(.+)/i,
        salePrice: /Cena Sprzedaży:\s*([\d,]+)/i,
        photo: /Zdjęcie Pojazdu:\s*(.+)/i,
        salePhoto: /Zdjęcie Sprzedaży Ze Strony:\s*(.+)/i
    };
    
    const data = { messageId, discordId: author.id, discordTag: author.tag };
    
    for (const [key, regex] of Object.entries(patterns)) {
        const match = content.match(regex);
        if (match) {
            let value = match[1].trim();
            
            if (key === 'salePrice') {
                value = parseInt(value.replace(/,/g, ''));
            }
            
            data[key] = value;
        }
    }
    
    const required = ['brand', 'model'];
    const hasAllRequired = required.every(field => data[field]);
    
    if (!hasAllRequired) return null;
    
    data.approved = false;
    data.submittedAt = new Date().toISOString();
    data.saleId = `SALE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return data;
}

// ================================================================
// NOWY SYSTEM - API COMMUNICATION
// ================================================================

/**
 * Wysyła dane do MDT
 */
async function sendToMDT(endpoint, data) {
    try {
        const response = await fetch(`${CONFIG.MDT_API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.MDT_API_KEY
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`MDT API error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`[MDT API] Błąd wysyłania do ${endpoint}:`, error);
        return null;
    }
}

/**
 * Zatwierdza entry w MDT
 */
async function approveMDT(type, id) {
    try {
        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/approve/${type}/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.MDT_API_KEY
            }
        });
        
        return response.ok;
    } catch (error) {
        console.error(`[MDT API] Błąd zatwierdzania ${type}/${id}:`, error);
        return false;
    }
}

// ================================================================
// EVENT HANDLERS
// ================================================================

/**
 * Bot gotowy
 */
client.once('ready', async () => {
    console.log(`========================================`);
    console.log(`[BOT] ✅ BOT GOTOWY!`);
    console.log(`========================================`);
    console.log(`[BOT] Zalogowano jako: ${client.user.tag}`);
    console.log(`[BOT] Bot ID: ${client.user.id}`);
    console.log(`[BOT] Serwery: ${client.guilds.cache.size}`);
    console.log(`========================================`);
    
    // Ustaw status
    client.user.setActivity('!allinfo @user | WSP & OCSO', { type: ActivityType.Watching });
    
    // Pobierz serwer
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        if (!guild) {
            console.error(`[BOT] ❌ Nie mogłem znaleźć serwera o ID: ${CONFIG.GUILD_ID}`);
            return;
        }
        
        console.log(`[BOT] Serwer: ${guild.name}`);
        console.log(`========================================`);
        
        // --- STARY SYSTEM: Synchronizacja członków ---
        if (CONFIG.SYNC_MEMBERS_ENABLED) {
            console.log(`[MEMBERS SYNC] ✅ Włączony (co ${CONFIG.SYNC_MEMBERS_INTERVAL_HOURS}h)`);
            await runMembersSync(guild);
            setInterval(() => runMembersSync(guild), CONFIG.SYNC_MEMBERS_INTERVAL_HOURS * 3600 * 1000);
        }
        
        // --- STARY SYSTEM: Sprawdzanie zawieszeń ---
        console.log(`[SUSPENDED] ✅ Włączony (co ${CONFIG.CHECK_SUSPENSIONS_INTERVAL_SECONDS}s)`);
        setInterval(() => checkSuspendedLicenses(guild), CONFIG.CHECK_SUSPENSIONS_INTERVAL_SECONDS * 1000);
        
        // --- NOWY SYSTEM: Economy sync ---
        if (CONFIG.ECONOMY_SYNC_ENABLED) {
            console.log(`[ECONOMY SYNC] ✅ Włączony (co ${CONFIG.ECONOMY_SYNC_INTERVAL_HOURS}h)`);
            startEconomyAutoSync();
        }
        
        console.log(`========================================`);
        console.log(`[BOT] 📋 Monitorowanie kanałów Economy:`);
        console.log(`  - Dowody: ${CONFIG.CHANNELS.CITIZEN_ID}`);
        console.log(`  - Pojazdy: ${CONFIG.CHANNELS.VEHICLE_PURCHASE}`);
        console.log(`  - OC: ${CONFIG.CHANNELS.VEHICLE_INSURANCE}`);
        console.log(`  - Sprzedaż: ${CONFIG.CHANNELS.VEHICLE_SALE}`);
        console.log(`========================================`);
        console.log(`[BOT] 🎮 Dostępne komendy:`);
        console.log(`  - !sync - Synchronizuj członków (Admin)`);
        console.log(`  - !allinfo @user - Wszystkie dane użytkownika`);
        console.log(`========================================`);
        console.log(`[BOT] 🚀 System gotowy do pracy!`);
        console.log(`========================================`);
        
    } catch (error) {
        console.error(`[BOT] Nie udało się pobrać serwera o ID ${CONFIG.GUILD_ID}:`, error);
    }
});

/**
 * Nowa wiadomość - parsowanie formularzy
 */
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    
    const channelId = message.channel.id;
    const content = message.content;
    
    let parsedData = null;
    let type = null;
    let endpoint = null;
    
    // Sprawdź który kanał i parsuj
    if (channelId === CONFIG.CHANNELS.CITIZEN_ID) {
        parsedData = parseCitizenID(content, message.author, message.id);
        type = 'citizen';
        endpoint = '/api/discord/citizen-data';
    } else if (channelId === CONFIG.CHANNELS.VEHICLE_PURCHASE) {
        parsedData = parseVehiclePurchase(content, message.author, message.id);
        type = 'vehicle';
        endpoint = '/api/discord/vehicles';
    } else if (channelId === CONFIG.CHANNELS.VEHICLE_INSURANCE) {
        parsedData = parseInsurance(content, message.author, message.id);
        type = 'insurance';
        endpoint = '/api/discord/insurance';
    } else if (channelId === CONFIG.CHANNELS.VEHICLE_SALE) {
        parsedData = parseVehicleSale(content, message.author, message.id);
        type = 'sale';
        endpoint = '/api/discord/vehicle-sale';
    }
    
    // Jeśli sparsowano poprawnie
    if (parsedData) {
        console.log(`[PARSER] Znaleziono prawidłowy ${type} od ${message.author.tag}`);
        
        const result = await sendToMDT(endpoint, parsedData);
        
        if (result && result.success) {
            await message.react('⏳');
            
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(`${type.toUpperCase()} - Oczekuje na zatwierdzenie`)
                .setDescription(`Twoje zgłoszenie zostało przyjęte i oczekuje na weryfikację.`)
                .addFields(
                    { name: 'Status', value: '⏳ Niezatwierdzone', inline: true },
                    { name: 'ID', value: parsedData[`${type}Id`] || parsedData.messageId, inline: true }
                )
                .setFooter({ text: 'Kliknij ✅ aby zatwierdzić (tylko admin)' })
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
            
            console.log(`[MDT] Wysłano ${type} do MDT:`, result);
        } else {
            await message.react('❌');
            await message.reply('❌ Błąd wysyłania danych do MDT.');
        }
    }
});

/**
 * Reakcja dodana - zatwierdzanie
 */
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('[REACTION] Błąd fetchowania reakcji:', error);
            return;
        }
    }
    
    if (reaction.emoji.name !== '✅') return;
    
    const member = reaction.message.guild.members.cache.get(user.id);
    if (!member || !member.permissions.has('Administrator')) {
        return;
    }
    
    const message = reaction.message;
    const channelId = message.channel.id;
    
    let type = null;
    if (channelId === CONFIG.CHANNELS.CITIZEN_ID) type = 'citizen';
    else if (channelId === CONFIG.CHANNELS.VEHICLE_PURCHASE) type = 'vehicle';
    else if (channelId === CONFIG.CHANNELS.VEHICLE_INSURANCE) type = 'insurance';
    else if (channelId === CONFIG.CHANNELS.VEHICLE_SALE) type = 'sale';
    
    if (!type) return;
    
    const success = await approveMDT(type, message.id);
    
    if (success) {
        await message.reactions.cache.get('⏳')?.remove();
        await message.react('✅');
        
        if (message.embeds.length > 0) {
            const oldEmbed = message.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed)
                .setColor('#00FF00')
                .setTitle(oldEmbed.title.replace('Oczekuje na zatwierdzenie', 'ZATWIERDZONE'))
                .spliceFields(0, 1, { name: 'Status', value: '✅ Zatwierdzone', inline: true });
            
            await message.edit({ embeds: [newEmbed] });
        }
        
        console.log(`[APPROVE] ${type} ${message.id} zatwierdzone przez ${user.tag}`);
    } else {
        await message.reply('❌ Błąd zatwierdzania w MDT.');
    }
});

// ================================================================
// KOMENDA !sync (stary system)
// ================================================================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith('!sync')) return;

    try {
        const member = message.member ?? await message.guild.members.fetch(message.author.id);
        
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Nie masz uprawnień do używania tej komendy.');
        }
        
        await runMembersSync(message.guild, message.channel);
    } catch (error) {
        console.error('[COMMAND] Błąd przy komendzie !sync:', error);
        await message.reply(`❌ Wystąpił błąd: ${error.message}`);
    }
});

// ================================================================
// KOMENDA !allinfo @user (nowy system)
// ================================================================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!allinfo')) return;
    
    console.log(`[ALLINFO] Otrzymano komendę od ${message.author.tag}`);
    
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
        console.log('[ALLINFO] Brak @mention użytkownika');
        return message.reply('❌ Użycie: `!allinfo @user`\n\n**Przykład:** `!allinfo @Jan`');
    }
    
    console.log(`[ALLINFO] Sprawdzam dane dla: ${mentionedUser.tag} (${mentionedUser.id})`);
    
    try {
        console.log(`[ALLINFO] Wysyłam request do MDT...`);
        
        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/info/${mentionedUser.id}`, {
            headers: {
                'X-API-Key': CONFIG.MDT_API_KEY
            }
        });
        
        console.log(`[ALLINFO] Odpowiedź MDT: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            console.log(`[ALLINFO] ❌ MDT nie znalazł danych (status ${response.status})`);
            return message.reply(`❌ Nie znaleziono danych dla użytkownika ${mentionedUser.tag}.\n\n💡 Użytkownik musi najpierw:\n- Wypełnić dowód osobisty\n- Zarejestrować pojazd\n- Uzyskać zatwierdzenie (✅)`);
        }
        
        const data = await response.json();
        console.log(`[ALLINFO] ✅ Pobrano dane. Obywatel: ${data.citizen ? 'TAK' : 'NIE'}, Pojazdy: ${data.vehicles?.length || 0}`);
        
        // Twórz embed
        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle(`📋 Wszystkie Informacje: ${data.citizen?.firstName || mentionedUser.username} ${data.citizen?.lastName || ''}`)
            .setThumbnail(mentionedUser.displayAvatarURL())
            .setTimestamp();
        
        // Dowód osobisty
        if (data.citizen) {
            const c = data.citizen;
            embed.addFields({
                name: '🆔 Dowód Osobisty',
                value: `**Imię i Nazwisko:** ${c.firstName} ${c.lastName}
**Wiek:** ${c.age} lat
**Data urodzenia:** ${c.dateOfBirth || 'Brak'}
**Płeć:** ${c.gender}
**Nick Roblox:** ${c.robloxNick}
**Kraj pochodzenia:** ${c.countryOfOrigin || 'Brak'}
**Status:** ${c.approved ? '✅ Zatwierdzony' : '⏳ Niezatwierdzony'}
**Ostatnia edycja:** ${c.lastEditDate ? new Date(c.lastEditDate).toLocaleString('pl-PL') : 'Brak'}`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🆔 Dowód Osobisty',
                value: '❌ Brak dowodu osobistego',
                inline: false
            });
        }
        
        // Pojazdy
        if (data.vehicles && data.vehicles.length > 0) {
            const vehiclesText = data.vehicles.map(v => {
                const oc = data.insurance?.find(i => i.plate === v.plate);
                const ocStatus = oc ? (oc.approved ? '✅ Aktywne' : '⏳ W trakcie') : '❌ Brak';
                
                return `**${v.brand} ${v.model}** (${v.year})
  📋 Tablice: \`${v.plate}\`
  🎨 Kolor: ${v.color}
  🛡️ OC: ${ocStatus}
  ${v.approved ? '✅' : '⏳'} ${v.approved ? 'Zarejestrowany' : 'Niezarejestrowany'}`;
            }).join('\n\n');
            
            embed.addFields({
                name: `🚗 Pojazdy (${data.vehicles.length})`,
                value: vehiclesText,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🚗 Pojazdy',
                value: '❌ Brak zarejestrowanych pojazdów',
                inline: false
            });
        }
        
        // Statystyki
        if (data.stats) {
            embed.addFields({
                name: '📊 Statystyki',
                value: `**Pojazdy:** ${data.stats.totalVehicles}
**Z OC:** ${data.stats.insuredVehicles}
**Ważny dowód:** ${data.stats.hasValidID ? '✅' : '❌'}`,
                inline: false
            });
        }
        
        await message.reply({ embeds: [embed] });
        console.log(`[ALLINFO] ✅ Wysłano odpowiedź do ${message.author.tag}`);
        
    } catch (error) {
        console.error('[ALLINFO] Błąd:', error);
        await message.reply('❌ Błąd pobierania danych z MDT. Sprawdź logi bota.');
    }
});

// ================================================================
// AUTO-SYNC ECONOMY
// ================================================================

function startEconomyAutoSync() {
    cron.schedule(`0 */${CONFIG.ECONOMY_SYNC_INTERVAL_HOURS} * * *`, async () => {
        console.log('[ECONOMY SYNC] Rozpoczynam synchronizację...');
        
        try {
            const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': CONFIG.MDT_API_KEY
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('[ECONOMY SYNC] ✅ Synchronizacja zakończona:', result);
            } else {
                console.error('[ECONOMY SYNC] ❌ Błąd synchronizacji:', response.status);
            }
        } catch (error) {
            console.error('[ECONOMY SYNC] ❌ Błąd:', error);
        }
    });
    
    console.log(`[ECONOMY SYNC] Uruchomiono (co ${CONFIG.ECONOMY_SYNC_INTERVAL_HOURS}h)`);
}

// ================================================================
// KOMENDA !importall (BULK IMPORT WSZYSTKICH WIADOMOŚCI)
// ================================================================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!importall')) return;
    
    // Sprawdź uprawnienia (tylko admin)
    const member = message.member ?? await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply('❌ Nie masz uprawnień do używania tej komendy (wymagane: Administrator).');
    }
    
    console.log(`[IMPORT ALL] Komenda otrzymana od ${message.author.tag}`);
    
    await message.reply('🔄 Rozpoczynam bulk import wszystkich wiadomości z kanałów...\n\n⏳ To może potrwać kilka minut!');
    
    try {
        const results = {
            citizens: { total: 0, imported: 0, skipped: 0 },
            vehicles: { total: 0, imported: 0, skipped: 0 },
            insurance: { total: 0, imported: 0, skipped: 0 },
            sales: { total: 0, imported: 0, skipped: 0 }
        };
        
        // ================================================================
        // 1. IMPORTUJ DOWODY OSOBISTE
        // ================================================================
        
        if (CONFIG.CHANNELS.CITIZEN_ID) {
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.CITIZEN_ID);
                if (channel) {
                    console.log(`[IMPORT ALL] Skanowanie kanału dowodów...`);
                    await message.reply('📋 Skanowanie dowodów osobistych...');
                    
                    let messages = [];
                    let lastId = null;
                    
                    // Pobierz wszystkie wiadomości (max 1000)
                    for (let i = 0; i < 10; i++) {
                        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
                        if (batch.size === 0) break;
                        messages = messages.concat([...batch.values()]);
                        lastId = batch.last().id;
                    }
                    
                    const parsedCitizens = [];
                    
                    messages.forEach(msg => {
                        if (msg.author.bot) return;
                        const parsed = parseCitizenID(msg.content, msg.author, msg.id);
                        if (parsed) {
                            parsedCitizens.push(parsed);
                        }
                    });
                    
                    results.citizens.total = parsedCitizens.length;
                    
                    // Wyślij do MDT
                    if (parsedCitizens.length > 0) {
                        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/bulk-import`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': CONFIG.MDT_API_KEY
                            },
                            body: JSON.stringify({
                                type: 'citizens',
                                data: parsedCitizens
                            })
                        });
                        
                        if (response.ok) {
                            const result = await response.json();
                            results.citizens.imported = result.imported;
                            results.citizens.skipped = result.skipped;
                            console.log(`[IMPORT ALL] Dowody: ${result.imported} zaimportowano, ${result.skipped} pominięto`);
                        }
                    }
                }
            } catch (error) {
                console.error('[IMPORT ALL] Błąd importu dowodów:', error);
            }
        }
        
        // ================================================================
        // 2. IMPORTUJ POJAZDY
        // ================================================================
        
        if (CONFIG.CHANNELS.VEHICLE_PURCHASE) {
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.VEHICLE_PURCHASE);
                if (channel) {
                    console.log(`[IMPORT ALL] Skanowanie kanału pojazdów...`);
                    await message.reply('🚗 Skanowanie rejestracji pojazdów...');
                    
                    let messages = [];
                    let lastId = null;
                    
                    for (let i = 0; i < 10; i++) {
                        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
                        if (batch.size === 0) break;
                        messages = messages.concat([...batch.values()]);
                        lastId = batch.last().id;
                    }
                    
                    const parsedVehicles = [];
                    
                    messages.forEach(msg => {
                        if (msg.author.bot) return;
                        const parsed = parseVehiclePurchase(msg.content, msg.author, msg.id);
                        if (parsed) {
                            parsedVehicles.push(parsed);
                        }
                    });
                    
                    results.vehicles.total = parsedVehicles.length;
                    
                    if (parsedVehicles.length > 0) {
                        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/bulk-import`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': CONFIG.MDT_API_KEY
                            },
                            body: JSON.stringify({
                                type: 'vehicles',
                                data: parsedVehicles
                            })
                        });
                        
                        if (response.ok) {
                            const result = await response.json();
                            results.vehicles.imported = result.imported;
                            results.vehicles.skipped = result.skipped;
                            console.log(`[IMPORT ALL] Pojazdy: ${result.imported} zaimportowano, ${result.skipped} pominięto`);
                        }
                    }
                }
            } catch (error) {
                console.error('[IMPORT ALL] Błąd importu pojazdów:', error);
            }
        }
        
        // ================================================================
        // 3. IMPORTUJ UBEZPIECZENIA OC
        // ================================================================
        
        if (CONFIG.CHANNELS.VEHICLE_INSURANCE) {
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.VEHICLE_INSURANCE);
                if (channel) {
                    console.log(`[IMPORT ALL] Skanowanie kanału OC...`);
                    await message.reply('🛡️ Skanowanie ubezpieczeń OC...');
                    
                    let messages = [];
                    let lastId = null;
                    
                    for (let i = 0; i < 10; i++) {
                        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
                        if (batch.size === 0) break;
                        messages = messages.concat([...batch.values()]);
                        lastId = batch.last().id;
                    }
                    
                    const parsedInsurance = [];
                    
                    messages.forEach(msg => {
                        if (msg.author.bot) return;
                        const parsed = parseInsurance(msg.content, msg.author, msg.id);
                        if (parsed) {
                            parsedInsurance.push(parsed);
                        }
                    });
                    
                    results.insurance.total = parsedInsurance.length;
                    
                    if (parsedInsurance.length > 0) {
                        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/bulk-import`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': CONFIG.MDT_API_KEY
                            },
                            body: JSON.stringify({
                                type: 'insurance',
                                data: parsedInsurance
                            })
                        });
                        
                        if (response.ok) {
                            const result = await response.json();
                            results.insurance.imported = result.imported;
                            results.insurance.skipped = result.skipped;
                            console.log(`[IMPORT ALL] OC: ${result.imported} zaimportowano, ${result.skipped} pominięto`);
                        }
                    }
                }
            } catch (error) {
                console.error('[IMPORT ALL] Błąd importu OC:', error);
            }
        }
        
        // ================================================================
        // 4. IMPORTUJ SPRZEDAŻ POJAZDÓW
        // ================================================================
        
        if (CONFIG.CHANNELS.VEHICLE_SALE) {
            try {
                const channel = await client.channels.fetch(CONFIG.CHANNELS.VEHICLE_SALE);
                if (channel) {
                    console.log(`[IMPORT ALL] Skanowanie kanału sprzedaży...`);
                    await message.reply('💰 Skanowanie sprzedaży pojazdów...');
                    
                    let messages = [];
                    let lastId = null;
                    
                    for (let i = 0; i < 10; i++) {
                        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
                        if (batch.size === 0) break;
                        messages = messages.concat([...batch.values()]);
                        lastId = batch.last().id;
                    }
                    
                    const parsedSales = [];
                    
                    messages.forEach(msg => {
                        if (msg.author.bot) return;
                        const parsed = parseVehicleSale(msg.content, msg.author, msg.id);
                        if (parsed) {
                            parsedSales.push(parsed);
                        }
                    });
                    
                    results.sales.total = parsedSales.length;
                    
                    if (parsedSales.length > 0) {
                        const response = await fetch(`${CONFIG.MDT_API_URL}/api/discord/bulk-import`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': CONFIG.MDT_API_KEY
                            },
                            body: JSON.stringify({
                                type: 'sales',
                                data: parsedSales
                            })
                        });
                        
                        if (response.ok) {
                            const result = await response.json();
                            results.sales.imported = result.imported;
                            results.sales.skipped = result.skipped;
                            console.log(`[IMPORT ALL] Sprzedaż: ${result.imported} zaimportowano, ${result.skipped} pominięto`);
                        }
                    }
                }
            } catch (error) {
                console.error('[IMPORT ALL] Błąd importu sprzedaży:', error);
            }
        }
        
        // ================================================================
        // PODSUMOWANIE
        // ================================================================
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Bulk Import Zakończony!')
            .setDescription('Wszystkie kanały zostały przeskanowane')
            .addFields(
                { 
                    name: '📋 Dowody Osobiste', 
                    value: `Znaleziono: ${results.citizens.total}\nZaimportowano: ${results.citizens.imported}\nPominięto: ${results.citizens.skipped}`,
                    inline: true 
                },
                { 
                    name: '🚗 Pojazdy', 
                    value: `Znaleziono: ${results.vehicles.total}\nZaimportowano: ${results.vehicles.imported}\nPominięto: ${results.vehicles.skipped}`,
                    inline: true 
                },
                { 
                    name: '🛡️ Ubezpieczenia OC', 
                    value: `Znaleziono: ${results.insurance.total}\nZaimportowano: ${results.insurance.imported}\nPominięto: ${results.insurance.skipped}`,
                    inline: true 
                },
                { 
                    name: '💰 Sprzedaż', 
                    value: `Znaleziono: ${results.sales.total}\nZaimportowano: ${results.sales.imported}\nPominięto: ${results.sales.skipped}`,
                    inline: true 
                }
            )
            .setFooter({ text: '⚠️ Wszystkie entry są niezatwierdzone! Zatwierdź je reakcją ✅' })
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        
        console.log(`[IMPORT ALL] ✅ Zakończono bulk import`);
        
    } catch (error) {
        console.error('[IMPORT ALL] Błąd:', error);
        await message.reply(`❌ Wystąpił błąd podczas importu: ${error.message}`);
    }
});

// ================================================================
// URUCHOMIENIE BOTA
// ================================================================

client.login(CONFIG.DISCORD_TOKEN);

// Obsługa błędów
client.on('error', error => {
    console.error('[BOT] Błąd:', error);
});

process.on('unhandledRejection', error => {
    console.error('[BOT] Unhandled rejection:', error);
});

console.log('[BOT] Uruchamianie bota...');
