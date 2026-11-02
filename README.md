# Chat Translate — a Sauce for Zwift mod

Translates Zwift chat into your language, right inside the Sauce **Chat** window.

By Michael B. Thanks to ZDR, Dwgz, WoW, and WBR500.

- Messages in another language are replaced with their translation, shown in italics.
- A badge in front of each translated message shows a **flag** and the **original language code** (e.g. `🇩🇪 DE`).
  - Languages tied to one country (Japanese, Italian, Polish, Danish, Swedish, Finnish, Greek, Turkish, Ukrainian, …) show that country's flag.
  - Languages spoken in many countries (English, Spanish, French, German, Portuguese, Russian, Arabic, Chinese, Dutch, …) show the **rider's own flag** from their Zwift profile.
- **Click a translated message** to switch between the translation and the original. Hovering shows the original too.
- Messages already in your language are left alone.
- **Rider names are never translated.** Names of chat senders and nearby riders (plus a short built-in list, e.g. Sereena and Jonnie) are kept exactly as written, and a message that's only a name isn't translated at all. To keep any other word, **right-click it in a chat message and choose “Never translate”**. Your saved words are listed at the top of the translate button's menu; click one to remove it.
- Pick your language (or turn translation **Off**) with the **translate** button in the Chat window's title bar. It defaults to your computer's language.

## Install

1. Quit Sauce for Zwift.
2. Unzip this file. You'll get a folder named `chat-translate`.
3. Move that folder into your Sauce mods folder:
   - **Mac:** `~/Documents/SauceMods/`
   - **Windows:** `Documents\SauceMods\`
   
   (Create `SauceMods` if it doesn't exist.) The result should be `Documents/SauceMods/chat-translate/manifest.json`.
4. Start Sauce. When it asks about the **New Sauce MOD**, click **Enable Now**. Sauce restarts with the mod active.

To uninstall, quit Sauce and delete the `chat-translate` folder (or turn the mod off on Sauce's Mods page).

> Sauce reads mods only at startup. After installing or updating, quit Sauce completely (Sauce menu → Quit) and reopen it. Closing the Chat window is not enough.

## Requirements

- Sauce for Zwift with mod support (tested on 2.4.0-alpha.5).
- An internet connection.

## Privacy

To translate a message, its text is sent to Google Translate's public web endpoint. If Google refuses the request, the text goes to the free MyMemory translation API instead. Rider names in a message are replaced with a placeholder before sending, and nothing else is sent: no rider IDs or other data. MyMemory's free tier has a daily character limit; if it's reached, untranslated messages simply stay in their original language.

## Limitations

- Language detection on very short messages ("Si?", "Ja") can guess wrong.
- Translation quality is machine translation.
- Emoji-only and number-only messages are skipped.
