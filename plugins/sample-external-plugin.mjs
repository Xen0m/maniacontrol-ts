const CHAT_COMMAND = "sample-external";

function createSampleExternalPlugin() {
  let context;
  let onChatCommand;

  return {
    id: "sample-external",

    async setup(runtimeContext) {
      context = runtimeContext;
      const enabled = runtimeContext.pluginConfig.settings?.exampleFlag === true;

      runtimeContext.logger.info(
        {
          enabled,
          titleId: runtimeContext.systemInfo.titleId,
          serverLogin: runtimeContext.systemInfo.serverLogin,
        },
        "Sample external plugin configured"
      );

      onChatCommand = (event) => {
        if (!event?.commandText) {
          return;
        }
        const command = String(event.commandText).trim().toLowerCase();
        if (command !== CHAT_COMMAND) {
          return;
        }

        runtimeContext.logger.info(
          {
            login: event.login,
            command: CHAT_COMMAND,
          },
          "Sample external command received"
        );
      };

      runtimeContext.callbacks.on("player-chat:command", onChatCommand);
    },

    async start() {
      context?.logger.info({ command: `/${CHAT_COMMAND}` }, "Sample external plugin started");
    },

    async stop() {
      if (context && onChatCommand) {
        context.callbacks.off("player-chat:command", onChatCommand);
      }
      context?.logger.info("Sample external plugin stopped");
      onChatCommand = undefined;
      context = undefined;
    },
  };
}

export function createPlugin() {
  return createSampleExternalPlugin();
}
