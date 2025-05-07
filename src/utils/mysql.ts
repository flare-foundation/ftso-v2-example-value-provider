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
}

export async function getVotingHistory(feedName: string, limit = 5): Promise<VotingEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT voting_round_id, value, first_quartile, third_quartile, low, high, timestamp, turnout_bips
     FROM ftso_prices
     JOIN ftso_feeds ON ftso_feeds.id = ftso_prices.feed_id
     WHERE ftso_feeds.representation = ?
     ORDER BY voting_round_id DESC
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
    turnout_bips: row.turnout_bips, // ✅ hinzugefügt
  }));
}