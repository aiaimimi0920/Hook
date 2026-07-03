// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/svg+xml" href="/tauri.svg" />
          {assets}
        </head>
        <body class="w-screen h-screen">
          <div id="app" class="h-full">
            {children}
          </div>
          {scripts}
        </body>
      </html>
    )}
  />
));
