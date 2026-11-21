<p align="center"><img src="docs/media/cover-tr.png" alt="Tezgah: ajanların için terminal, projelerin için merkez" width="100%"></p>

<p align="center">
  <a href="https://github.com/itsyunusacar/tezgah/releases/latest"><img alt="İndir" src="https://img.shields.io/github/v/release/itsyunusacar/tezgah?label=indir&color=1A1918"></a>
  <img alt="macOS 15 ve sonrası" src="https://img.shields.io/badge/macOS-15%2B-777169">
  <img alt="Beta" src="https://img.shields.io/badge/durum-beta-D9730D">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/lisans-MIT-777169"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>Türkçe</b> · <a href="https://tezgah.itsyunusacar.com/tr">Web sitesi</a></p>

Tezgah, yapay zekâ kodlama ajanlarıyla çalışmak için yapılmış yerel bir Mac terminalidir. Çalıştığın bütün projeler, içlerinde açık olan oturumlarla birlikte tek pencerede durur; her ajan ne yaptığını söyler: çalışıyor, seni bekliyor, bitti. İçinde olduğun projeden çıkmadan başka bir projede ajan başlatırsın, ertesi gün aynı konuşmalara dönersin.

**Tezgah beta aşamasında.** Sık güncellenir; bozulan bir şey görürsen [Issues](https://github.com/itsyunusacar/tezgah/issues) sayfasına yaz.

<p align="center"><img src="docs/media/demo-tr.gif" alt="Tezgah açılıyor, bir projede Claude Code başlatılıyor, izin isteği yanıtlanıyor ve iş bitiyor" width="100%"></p>

<p align="center"><sub><a href="docs/media/demo-tr.mp4">Tam kalitede izle</a> · 32 saniye</sub></p>

## İndir

**[macOS için Tezgah](https://github.com/itsyunusacar/tezgah/releases/latest)** · macOS 15 ve sonrası · Apple silicon ve Intel · ücretsiz, hesap gerektirmez.

Zip dosyasını aç, Tezgah'ı Uygulamalar'a taşı. Sürüm henüz Apple tarafından onaylanmadı (notarize edilmedi); bu yüzden ilk seferde Tezgah'a sağ tıklayıp *Aç*'ı seç. Sonrasında kendini günceller.

Ajanları sen getirirsin: [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex/cli), [Grok](https://x.ai/cli) ya da komut satırından çalışan başka bir ajan. Kabuk oturumları hiçbiri olmadan da çalışır.

## Bütün projeler tek pencerede

<p align="center"><img src="docs/media/home-tr.jpg" alt="Ana sayfa: bir projede çalışan bir ajan, bir başkasında bitmiş bir ajan ve üç proje" width="100%"></p>

- **Ana sayfa** ilk açılan yerdir: bütün projelerinde kim seni bekliyor, kim çalışıyor, kim bitirdi.
- **Kenar çubuğu** oturumun yanında bütün projeleri, oturumlarını ve durumlarını listeler. Sırası senin verdiğin gibi kalır.
- **Her yerden başlat.** Yeni oturum seçicisi (⌘T) herhangi bir projede ajan başlatır; kendi sekmesinde ya da içinde olduğun oturumun yanında.
- **Olduğun yerden yanıtla.** Çubuktaki rozet kaç ajanın beklediğini gösterir; ⌘J seni sıradakine götürür.

## Ajanlar

<p align="center"><img src="docs/media/waiting-tr.jpg" alt="Claude Code testleri çalıştırmak için izin istiyor; bölme çerçevelenmiş, çubukta bir ajanın beklediği yazıyor" width="100%"></p>

| | Seçiciden başlar | Durum | Konuşmasına döner |
| --- | --- | --- | --- |
| **Claude Code** | evet | kendisi bildirir | evet |
| **Grok** | evet | kendisi bildirir | evet |
| **Codex** | evet | o çalıştırmaya özel bir kancayla | evet (yeni, az denendi) |
| **Diğer her şey** (Aider, OpenCode, Gemini CLI, Cursor Agent…) | Ayarlar › Ajanlar'dan eklenince | ekranda yaptıklarından okunur | yeni başlar |

Tezgah hiçbir ajanın kendi ayarlarını değiştirmez. Kanca eklediği yerde kanca yalnızca o çalıştırma için verilir.

## Konuşmalar projeyle birlikte durur

<p align="center"><img src="docs/media/board-tr.jpg" alt="Bir projenin panosu: oturumları, değişen dosyaları ve geçmiş konuşmaları" width="100%"></p>

Her projenin bir panosu vardır (⇧⌘B): açık oturumları, git çalışma ağacında değişenler ve ajanların o klasörde yaptığı bütün konuşmalar. Birine tıkla, kaldığı yerden devam et.

Ajanlar açıkken Tezgah'tan çıkarsan döndüğünde yerlerindedirler: her bölme, oturumunu açtığında ajanını aynı konuşmada yeniden başlatır. İlk mesajlar ve tek seferlik komutlar ikinci kez yazılmaz.

## Önce bir terminal

<p align="center"><img src="docs/media/session-tr.jpg" alt="İşini bitirmiş bir ajan ve yanında git status gösteren bir kabuk" width="100%"></p>

- [Ghostty](https://ghostty.org)'nin çizim motoruyla: hızlı; ligatürler, gerçek renk ve modern araçların beklediği klavye protokolleriyle.
- Alanı eşit paylaşan, sayıları artınca kendini ızgaraya dizen bölmeler (⌘D, ⇧⌘D).
- Aydınlık ve karanlık 16 tema, geçmişte arama (⌘F), her şey için ⌘K paleti.
- Finder'da klasöre sağ tık › *Tezgah'ta Aç*; betikler ve `ssh://` bağlantıları için varsayılan terminal yapabilirsin.
- Türkçe ve İngilizce.

## Kısayollar

| | |
| --- | --- |
| Yeni oturum · Yeni terminal | ⌘T · ⌘N |
| Sağa böl · aşağı böl · Izgaraya diz | ⌘D · ⇧⌘D · ⇧⌘G |
| Sonraki / önceki bölme | ⌥⌘→ · ⌥⌘← |
| Sonraki / önceki oturum | ⌃⇥ · ⌃⇧⇥ |
| Bekleyen sıradaki ajan | ⌘J |
| Her şeyi ara · Hızlı geçiş | ⌘K · ⌘P |
| Kenar çubuğu · Proje panosu · Ana sayfa | ⌘0 · ⇧⌘B · ⇧⌘H |

## Gizlilik

Tezgah hiçbir yere hiçbir şey göndermez: analiz yok, hesap yok. İki izin ister, bildirimler ve Finder eylemi; ikisi olmadan da çalışır.

## Kaynaktan derleme

Derleme adımları ve kodun yapısı için [İngilizce README](README.md#build-from-source)'ye bak.

## Lisans

[MIT](LICENSE). Geist ve Geist Mono [SIL Open Font License](Sources/Tezgah/Resources/Fonts/OFL-Geist.txt) altındadır.
