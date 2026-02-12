# Gencord – prosty klon Discorda (tekstowy)

Gencord to prosta aplikacja webowa inspirowana Discordem:

- **kanały tekstowe**
- **wiadomości w czasie rzeczywistym** (Socket.IO)
- **lekki, nowoczesny UI** przypominający Discorda

Całość działa w jednym projekcie Node.js: backend (Express + Socket.IO) serwuje również statyczny frontend z katalogu `public/`.

## Wymagania

- **Node.js 18+**
- **npm** (menedżer pakietów Node)

## Instalacja

W katalogu `Gencord` (tym, w którym znajduje się ten plik) uruchom w terminalu:

```bash
npm install
```

To polecenie zainstaluje zależności z `package.json`:

- `express`
- `socket.io`
- `cors`

## Uruchomienie

```bash
npm start
```

Domyślnie serwer uruchomi się na:

- `http://localhost:3000`

Wejdź w przeglądarce na ten adres – zobaczysz aplikację Gencord.

## Funkcje

- **Kanały**: `#general`, `#games`, `#music` (zdefiniowane w pamięci w `server.js`)
- **Czat na żywo**:
  - wiadomości wysyłane są przez Socket.IO
  - każdy kanał ma własny strumień wiadomości
- **Prosta „tożsamość” użytkownika**:
  - przy wejściu podajesz nazwę użytkownika (zapisywana w `localStorage`)
  - nazwa wyświetla się w prawym górnym rogu i przy wiadomościach

## Ograniczenia względem prawdziwego Discorda

To jest **prosty klon funkcjonalny**, a nie pełny Discord:

- brak rejestracji/logowania z bazą danych
- brak serwerów (jest jedna „instancja” z kilkoma kanałami)
- brak wiadomości prywatnych
- brak rozmów głosowych / wideo

Możesz jednak rozbudować ten projekt:

- dodać bazę danych (np. PostgreSQL, MongoDB, SQLite)
- dodać konta użytkowników i logowanie
- dodać tworzenie własnych kanałów, uprawnienia, itp.

