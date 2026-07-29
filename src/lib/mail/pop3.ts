import tls from "tls";

/**
 * 최소 기능 POP3 클라이언트 (TLS 전용).
 * 하이웍스처럼 IMAP 없이 POP3만 제공하는 메일 서버의 수신용.
 */
export class Pop3Client {
  private socket: tls.TLSSocket | null = null;
  private buffer = "";
  private waiters: {
    multiline: boolean;
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  }[] = [];

  connect(host: string, port: number, timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host }, () => {
        /* greeting 은 data 이벤트로 도착 */
      });
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        this.failAll(new Error("POP3 응답 시간 초과"));
        reject(new Error("POP3 접속 시간 초과"));
      });
      socket.on("error", (err) => {
        this.failAll(err);
        reject(err);
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      // 서버 인사말(+OK ...)을 첫 응답으로 대기
      this.waiters.push({
        multiline: false,
        resolve: () => resolve(),
        reject,
      });
    });
  }

  private failAll(err: Error) {
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (waiter.multiline) {
        // 멀티라인: +OK ... \r\n <본문> \r\n.\r\n  /  -ERR 은 한 줄
        if (this.buffer.startsWith("-ERR")) {
          const nl = this.buffer.indexOf("\r\n");
          if (nl === -1) return;
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 2);
          this.waiters.shift();
          waiter.reject(new Error(line));
          continue;
        }
        const end = this.buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        const full = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 5);
        this.waiters.shift();
        const firstNl = full.indexOf("\r\n");
        // 상태줄 제거 + 점 이스케이프 복원 (..→.)
        const body = (firstNl === -1 ? "" : full.slice(firstNl + 2)).replace(/^\.\./gm, ".");
        waiter.resolve(body);
      } else {
        const nl = this.buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 2);
        this.waiters.shift();
        if (line.startsWith("+OK")) waiter.resolve(line);
        else waiter.reject(new Error(line || "POP3 오류"));
      }
    }
  }

  private send(cmd: string, multiline: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("연결되지 않음"));
      this.waiters.push({ multiline, resolve, reject });
      this.socket.write(cmd + "\r\n");
    });
  }

  async login(user: string, pass: string): Promise<void> {
    await this.send(`USER ${user}`, false);
    await this.send(`PASS ${pass}`, false);
  }

  /** 메일 번호 ↔ 고유 ID 목록 */
  async uidl(): Promise<{ num: number; uid: string }[]> {
    const body = await this.send("UIDL", true);
    return body
      .split("\r\n")
      .filter(Boolean)
      .map((line) => {
        const [num, uid] = line.trim().split(/\s+/);
        return { num: Number(num), uid: uid ?? "" };
      })
      .filter((m) => m.num > 0 && m.uid);
  }

  /** 헤더만 가져오기 (본문 0줄) */
  top(num: number): Promise<string> {
    return this.send(`TOP ${num} 0`, true);
  }

  /** 메일 전체 원문 */
  retr(num: number): Promise<string> {
    return this.send(`RETR ${num}`, true);
  }

  async quit(): Promise<void> {
    try {
      await this.send("QUIT", false);
    } catch {
      /* ignore */
    }
    this.socket?.destroy();
    this.socket = null;
  }
}
