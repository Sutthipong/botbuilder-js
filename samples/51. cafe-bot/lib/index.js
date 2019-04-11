"use strict";
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path = require("path");
const restify = require("restify");
const botbuilder_dialogs_1 = require("botbuilder-dialogs");
// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const botbuilder_1 = require("botbuilder");
// Import required bot configuration.
const botframework_config_1 = require("botframework-config");
const rootDialog_1 = require("./rootDialog");
// Read botFilePath and botFileSecret from .env file
// Note: Ensure you have a .env file and include botFilePath and botFileSecret.
const ENV_FILE = path.join(__dirname, '..', '.env');
const loadFromEnv = dotenv_1.config({ path: ENV_FILE });
// Get the .bot file path.
// See https://aka.ms/about-bot-file to learn more about .bot file its use and bot configuration.
const BOT_FILE = path.join(__dirname, '..', (process.env.botFilePath || ''));
let botConfig;
try {
    // Read bot configuration from .bot file.
    botConfig = botframework_config_1.BotConfiguration.loadSync(BOT_FILE, process.env.botFileSecret);
}
catch (err) {
    console.error(`\nError reading bot file. Please ensure you have valid botFilePath and botFileSecret set for your environment.`);
    console.error(`\n - The botFileSecret is available under appsettings for your Azure Bot Service bot.`);
    console.error(`\n - If you are running this bot locally, consider adding a .env file with botFilePath and botFileSecret.`);
    console.error(`\n - See https://aka.ms/about-bot-file to learn more about .bot file its use and bot configuration.\n\n`);
    process.exit();
}
// For local development configuration as defined in .bot file
const DEV_ENVIRONMENT = 'development';
// Define name of the endpoint configuration section from the .bot file.
const BOT_CONFIGURATION = (process.env.NODE_ENV || DEV_ENVIRONMENT);
// Get bot endpoint configuration by service name.
// Bot configuration as defined in .bot file.
const endpointConfig = botConfig.findServiceByNameOrId(BOT_CONFIGURATION);
// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about .bot file its use and bot configuration .
const adapter = new botbuilder_1.BotFrameworkAdapter({
    appId: endpointConfig.appId || process.env.microsoftAppID,
    appPassword: endpointConfig.appPassword || process.env.microsoftAppPassword,
});
// Catch-all for errors.
adapter.onTurnError = async (context, error) => {
    // This check writes out errors to console log
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError]: ${error}`);
    // Send a message to the user
    context.sendActivity(`Oops. Something went wrong!`);
    // Clear out state
    await conversationState.delete(context);
};
// Define a state store for your bot. See https://aka.ms/about-bot-state to learn more about using MemoryStorage.
// A bot requires a state store to persist the dialog and user state between messages.
let conversationState;
let userState;
// For local development, in-memory storage is used.
// CAUTION: The Memory Storage used here is for local bot debugging only. When the bot
// is restarted, anything stored in memory will be gone.
const memoryStorage = new botbuilder_1.MemoryStorage();
conversationState = new botbuilder_1.ConversationState(memoryStorage);
userState = new botbuilder_1.UserState(memoryStorage);
// CAUTION: You must ensure your product environment has the NODE_ENV set
//          to use the Azure Blob storage or Azure Cosmos DB providers.
// Add botbuilder-azure when using any Azure services.
// import { BlobStorage } from 'botbuilder-azure';
// // Get service configuration
// const blobStorageConfig = botConfig.findServiceByNameOrId(STORAGE_CONFIGURATION_ID);
// const blobStorage = new BlobStorage({
//     containerName: (blobStorageConfig.container || DEFAULT_BOT_CONTAINER),
//     storageAccountOrConnectionString: blobStorageConfig.connectionString,
// });
// conversationState = new ConversationState(blobStorage);
// userState = new UserState(blobStorage);
// Create the main dialog.
// Create bots DialogManager and bind to state storage
const bot = new botbuilder_dialogs_1.DialogManager();
bot.storage = new botbuilder_1.MemoryStorage();
bot.rootDialog = new rootDialog_1.CafeBot(botConfig);
// Create HTTP server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3979, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log(`\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator`);
    console.log(`\nTo talk to your bot, open basic-bot.bot file in the Emulator`);
});
// Listen for incoming activities and route them to your bot main dialog.
server.post('/api/messages', (req, res) => {
    // Route received a request to adapter for processing
    adapter.processActivity(req, res, async (turnContext) => {
        // route to bot activity handler.
        await bot.onTurn(turnContext);
    });
});
//# sourceMappingURL=index.js.map