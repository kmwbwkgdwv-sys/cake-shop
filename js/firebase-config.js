/* =====================================================================
 *  Firebase の設定
 *  Firebase コンソール →（歯車）プロジェクトの設定 → マイアプリ（ウェブアプリ）
 *  に表示される firebaseConfig の値をここに入れます。
 *  ※ databaseURL（Realtime Database の URL）と projectId が必須です。
 *     まだ空のあいだは「オフラインモード」（ひとり用・この端末にだけ保存）で動きます。
 *
 *  ※ この値は公開されても問題ない設計です（データは database.rules.json で守ります）。
 * ===================================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyD8CK3jDMzfD2AkeEKq-ndRZsxjSIuzxJ0",
  authDomain: "cake-shop-fd414.firebaseapp.com",
  databaseURL: "https://cake-shop-fd414-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cake-shop-fd414",
  // ↓ なくても動きます（Firebase コンソールの firebaseConfig にある値を入れても OK）
  // storageBucket: "",
  // messagingSenderId: "",
  // appId: "",
};
