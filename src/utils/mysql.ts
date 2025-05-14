import mysql, { RowDataPacket } from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export interface VotingEntry {
  voting_round_id: number;
  value: number;
  first_quartile: number;
  third_quartile: number;
  low: number;
  high: number;
  timestamp: number;
  turnout_bips: number;
  submitted_price: number | null;
  decimals?: number;
}

export type PriceHistoryEntry = {
  voting_round_id: number;
  ccxt_price: number;
  submitted: number;
  ftso_value: number;
  decimals: number;
};

export async function getFeedId(feedName: string): Promise<number | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [feedName]);
  return rows.length > 0 ? rows[0].id : undefined;
}

export async function getPriceHistory(feedId: number, limit = 30): Promise<PriceHistoryEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT 
      ps.voting_round_id,
      ps.ccxt_price,
      ps.submitted_price AS submitted,
      fp.value AS ftso_value,
      ff.decimals
    FROM price_submissions ps
    JOIN ftso_prices fp ON ps.feed_id = fp.feed_id AND ps.voting_round_id = fp.voting_round_id
    JOIN ftso_feeds ff ON ps.feed_id = ff.id
    WHERE ps.feed_id = ?
    ORDER BY ps.voting_round_id DESC
    LIMIT ?
  `,
    [feedId, limit]
  );

  return rows.map(r => ({
    voting_round_id: Number(r.voting_round_id),
    ccxt_price: Number(r.ccxt_price) / 1e8,
    submitted: Number(r.submitted) / 1e8,
    ftso_value: Number(r.ftso_value) / 10 ** r.decimals,
    decimals: r.decimals,
  }));
}

export async function getFeedDecimals(feedName: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT decimals FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [
    feedName,
  ]);

  return rows.length > 0 ? rows[0].decimals : null;
}



export async function getVotingHistory(feedName: string, limit = 5): Promise<VotingEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.voting_round_id, p.value, p.first_quartile, p.third_quartile,
          p.low, p.high, r.timestamp, p.turnout_bips, s.submitted_price
   FROM ftso_prices p
   JOIN voting_rounds r ON r.id = p.voting_round_id
   JOIN ftso_feeds f ON f.id = p.feed_id
   LEFT JOIN price_submissions s ON s.feed_id = p.feed_id AND s.voting_round_id = p.voting_round_id
   WHERE f.feed_name = ?
   ORDER BY p.voting_round_id DESC
   LIMIT ?`,
    [feedName, limit]
  );

  return rows.map(row => ({
    voting_round_id: row.voting_round_id,
    value: parseFloat(row.value),
    first_quartile: parseFloat(row.first_quartile),
    third_quartile: parseFloat(row.third_quartile),
    low: parseFloat(row.low),
    high: parseFloat(row.high),
    timestamp: row.timestamp,
    turnout_bips: row.turnout_bips,
    submitted_price: row.submitted_price !== null ? parseFloat(row.submitted_price) : null,
  }));
}

export async function storeSubmittedPrice(
  feedName: string,
  votingRoundId: number,
  submitted: number,
  ccxt: number,
  onchain: number
): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [
      feedName,
    ]);

    if (rows.length === 0) {
      console.warn(`⚠️ Kein Feed mit feed_name='${feedName}' gefunden – Preis wird nicht gespeichert.`);
      return;
    }

    const feedId = rows[0].id;

    const scale = 1e8; // FIXED scale to match ftso_prices
    const submittedScaled = Math.round(submitted * scale);
    const ccxtScaled = Math.round(ccxt * scale);
    const onchainScaled = Math.round(onchain * scale);
    console.debug(
      `📦 Speichere Preis (1e8): submitted=${submitted} → ${submittedScaled}, ccxt=${ccxt} → ${ccxtScaled}, onchain=${onchain} → ${onchainScaled}`
    );

    await pool.query(`INSERT IGNORE INTO voting_rounds (id) VALUES (?)`, [votingRoundId]);

    await pool.query(
      `INSERT INTO price_submissions (feed_id, voting_round_id, submitted_price, ccxt_price, onchain_price)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         submitted_price = VALUES(submitted_price),
         onchain_price = VALUES(onchain_price),
         ccxt_price = VALUES(ccxt_price)`,
      [feedId, votingRoundId, submittedScaled, ccxtScaled]
    );
  } catch (err) {
    console.error("❌ Fehler bei storeSubmittedPrice:", err);
  }
}
