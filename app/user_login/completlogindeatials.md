<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Create a Login page using next.js for ui and core java backend and connect to database for Oracle SQL

Below is a working starter implementation using:

- Next.js for the login UI.
- **Java** for the backend, without Spring Boot.
- Oracle Database for user credentials.
- JDBC for database access.
- A server-side session and an HTTP-only cookie after login.

The Java backend uses the JDK’s built-in `HttpServer`; the only backend dependency is Oracle’s JDBC driver.[^1_1][^1_2]

## 1. Application structure

```text
login-project/
├── backend/
│   ├── pom.xml
│   └── src/main/java/demo/
│       ├── Passwords.java
│       ├── CreateUser.java
│       └── Main.java
└── frontend/
    ├── .env.local
    └── app/
        ├── page.tsx
        ├── dashboard/page.tsx
        └── api/auth/[action]/route.ts
```

Request flow:

```text
Browser
   ↓
Next.js /api/auth/login
   ↓
Java backend localhost:8080
   ↓
Oracle Database
```

The browser communicates with Next.js, and Next.js forwards authentication requests to Java. Next.js supports this through App Router route handlers. Database credentials remain exclusively in the Java process.[^1_3][^1_4]

This example is intended for local development. Production requirements are listed at the end.

## 2. Create the Oracle table

Run this SQL using SQL Developer or SQLcl, connected as your application’s database user:

```sql
CREATE TABLE app_users (
    user_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR2(254 CHAR) NOT NULL,
    password_salt VARCHAR2(64 CHAR) NOT NULL,
    password_hash VARCHAR2(128 CHAR) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT app_users_email_unique UNIQUE (email),
    CONSTRAINT app_users_email_lower CHECK (email = LOWER(email))
);
```

Passwords will be hashed, not stored as plaintext. This implementation uses Java’s PBKDF2-HMAC-SHA256 with 600,000 iterations and a random salt; OWASP documents this work factor for PBKDF2-HMAC-SHA256.[^1_5]

## 3. Create the Java backend

Requirements:

- JDK 21.
- Maven.
- A running Oracle Database.
- An application database user that owns the table above.


### `backend/pom.xml`

The Oracle JDBC dependency below is available from Maven Central.[^1_2]

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             https://maven.apache.org/xsd/maven-4.0.0.xsd">

    <modelVersion>4.0.0</modelVersion>

    <groupId>demo</groupId>
    <artifactId>oracle-login</artifactId>
    <version>1.0.0</version>

    <properties>
        <maven.compiler.release>21</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <dependency>
            <groupId>com.oracle.database.jdbc</groupId>
            <artifactId>ojdbc11</artifactId>
            <version>23.3.0.23.09</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
            </plugin>

            <plugin>
                <groupId>org.codehaus.mojo</groupId>
                <artifactId>exec-maven-plugin</artifactId>
                <version>3.5.0</version>
            </plugin>
        </plugins>
    </build>
</project>
```


### `backend/src/main/java/demo/Passwords.java`

```java
package demo;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public final class Passwords {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int ITERATIONS = 600_000;

    private Passwords() {}

    public static String newSalt() {
        byte[] salt = new byte[^1_16];
        RANDOM.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    public static byte[] hash(char[] password, String salt)
            throws Exception {
        PBEKeySpec spec = new PBEKeySpec(
            password,
            Base64.getDecoder().decode(salt),
            ITERATIONS,
            256
        );

        try {
            return SecretKeyFactory
                .getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(spec)
                .getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    public static boolean verify(
            char[] password, String salt, String storedHash)
            throws Exception {
        return MessageDigest.isEqual(
            hash(password, salt),
            Base64.getDecoder().decode(storedHash)
        );
    }
}
```


### `backend/src/main/java/demo/CreateUser.java`

This command-line utility creates the initial user without exposing a public registration endpoint.

```java
package demo;

import java.io.Console;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;

public class CreateUser {
    public static void main(String[] args) throws Exception {
        Console console = System.console();

        if (console == null) {
            throw new IllegalStateException(
                "Run this class from an interactive terminal."
            );
        }

        String email = console.readLine("Email: ")
            .trim()
            .toLowerCase(Locale.ROOT);

        char[] password = console.readPassword("Password: ");

        if (email.isBlank() || email.length() > 254 ||
                password == null || password.length < 12) {
            throw new IllegalArgumentException(
                "Enter a valid email and a password of at least 12 characters."
            );
        }

        try {
            String salt = Passwords.newSalt();
            String hash = Base64.getEncoder()
                .encodeToString(Passwords.hash(password, salt));

            try (
                Connection connection = DriverManager.getConnection(
                    Main.env("DB_URL"),
                    Main.env("DB_USER"),
                    Main.env("DB_PASSWORD")
                );
                PreparedStatement statement = connection.prepareStatement(
                    """
                    INSERT INTO app_users
                        (email, password_salt, password_hash)
                    VALUES (?, ?, ?)
                    """
                )
            ) {
                statement.setString(1, email);
                statement.setString(2, salt);
                statement.setString(3, hash);
                statement.executeUpdate();
            }

            System.out.println("User created.");
        } finally {
            Arrays.fill(password, '\0');
        }
    }
}
```


### `backend/src/main/java/demo/Main.java`

This provides three endpoints:


| Endpoint | Purpose |
| :-- | :-- |
| `POST /login` | Verify credentials and create a session |
| `GET /me` | Check whether the session is valid |
| `POST /logout` | Remove the session |

```java
package demo;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

public class Main {
    private record Session(long userId, Instant expiresAt) {}

    private static final Map<String, Session> SESSIONS =
        new ConcurrentHashMap<>();

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String DUMMY_SALT = Passwords.newSalt();
    private static final String DUMMY_HASH =
        Base64.getEncoder().encodeToString(new byte[^1_32]);

    public static String env(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + name);
        }
        return value;
    }

    public static void main(String[] args) throws Exception {
        env("DB_URL");
        env("DB_USER");
        env("DB_PASSWORD");

        HttpServer server = HttpServer.create(
            new InetSocketAddress("127.0.0.1", 8080), 0
        );

        server.createContext("/", Main::handle);
        server.setExecutor(Executors.newFixedThreadPool(8));

        ScheduledExecutorService cleanup =
            Executors.newSingleThreadScheduledExecutor();

        cleanup.scheduleAtFixedRate(
            () -> SESSIONS.entrySet().removeIf(
                entry -> !entry.getValue().expiresAt().isAfter(Instant.now())
            ),
            1, 1, TimeUnit.MINUTES
        );

        server.start();
        System.out.println("Backend running at http://127.0.0.1:8080");
    }

    private static void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();

            switch (path) {
                case "/login" -> {
                    if (!method.equals("POST")) {
                        json(exchange, 405, "{\"error\":\"Method not allowed\"}");
                        return;
                    }
                    login(exchange);
                }
                case "/me" -> {
                    if (!method.equals("GET")) {
                        json(exchange, 405, "{\"error\":\"Method not allowed\"}");
                        return;
                    }

                    Session session = SESSIONS.get(sessionToken(exchange));
                    boolean valid = session != null &&
                        session.expiresAt().isAfter(Instant.now());

                    json(exchange, valid ? 200 : 401,
                        valid
                            ? "{\"authenticated\":true}"
                            : "{\"error\":\"Unauthorized\"}");
                }
                case "/logout" -> {
                    if (!method.equals("POST")) {
                        json(exchange, 405, "{\"error\":\"Method not allowed\"}");
                        return;
                    }

                    SESSIONS.remove(sessionToken(exchange));
                    json(exchange, 200, "{\"ok\":true}");
                }
                default -> json(exchange, 404, "{\"error\":\"Not found\"}");
            }
        } catch (IllegalArgumentException exception) {
            json(exchange, 400, "{\"error\":\"Invalid request\"}");
        } catch (Exception exception) {
            exception.printStackTrace();
            json(exchange, 500, "{\"error\":\"Server error\"}");
        } finally {
            exchange.close();
        }
    }

    private static void login(HttpExchange exchange) throws Exception {
        String contentType =
            exchange.getRequestHeaders().getFirst("Content-Type");

        if (contentType == null ||
            !contentType.startsWith("application/x-www-form-urlencoded")) {
            json(exchange, 415, "{\"error\":\"Unsupported content type\"}");
            return;
        }

        byte[] body = exchange.getRequestBody().readNBytes(8193);
        if (body.length > 8192) {
            json(exchange, 413, "{\"error\":\"Request too large\"}");
            return;
        }

        Map<String, String> form = parseForm(
            new String(body, StandardCharsets.UTF_8)
        );

        String email = form.getOrDefault("email", "")
            .trim().toLowerCase(Locale.ROOT);
        String password = form.getOrDefault("password", "");

        if (email.isBlank() || email.length() > 254 ||
                password.isBlank() || password.length() > 1024) {
            json(exchange, 400, "{\"error\":\"Invalid email or password\"}");
            return;
        }

        long userId = -1;
        String salt = DUMMY_SALT;
        String hash = DUMMY_HASH;

        try (
            Connection connection = DriverManager.getConnection(
                env("DB_URL"), env("DB_USER"), env("DB_PASSWORD")
            );
            PreparedStatement statement = connection.prepareStatement(
                """
                SELECT user_id, password_salt, password_hash
                FROM app_users WHERE email = ?
                """
            )
        ) {
            statement.setQueryTimeout(10);
            statement.setString(1, email);

            try (ResultSet result = statement.executeQuery()) {
                if (result.next()) {
                    userId = result.getLong("user_id");
                    salt = result.getString("password_salt");
                    hash = result.getString("password_hash");
                }
            }
        }

        char[] chars = password.toCharArray();
        boolean matches;

        try {
            matches = Passwords.verify(chars, salt, hash);
        } finally {
            Arrays.fill(chars, '\0');
        }

        if (!matches || userId == -1) {
            json(exchange, 401, "{\"error\":\"Invalid email or password\"}");
            return;
        }

        byte[] bytes = new byte[^1_32];
        RANDOM.nextBytes(bytes);

        String token = Base64.getUrlEncoder()
            .withoutPadding().encodeToString(bytes);

        SESSIONS.put(token, new Session(
            userId, Instant.now().plusSeconds(3600)
        ));

        exchange.getResponseHeaders().set("X-Session-Token", token);
        json(exchange, 200, "{\"ok\":true}");
    }

    private static Map<String, String> parseForm(String body) {
        Map<String, String> result = new HashMap<>();

        for (String pair : body.split("&")) {
            String[] parts = pair.split("=", 2);
            if (parts.length == 2) {
                result.put(
                    URLDecoder.decode(parts[^1_0], StandardCharsets.UTF_8),
                    URLDecoder.decode(parts[^1_1], StandardCharsets.UTF_8)
                );
            }
        }

        return result;
    }

    private static String sessionToken(HttpExchange exchange) {
        String authorization =
            exchange.getRequestHeaders().getFirst("Authorization");

        return authorization != null && authorization.startsWith("Bearer ")
            ? authorization.substring(7)
            : "";
    }

    private static void json(
            HttpExchange exchange, int status, String body)
            throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set(
            "Content-Type", "application/json; charset=utf-8"
        );
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
```


## 4. Configure Oracle access and start Java

The service-name JDBC URL format is:

```text
jdbc:oracle:thin:@//HOST:PORT/SERVICE_NAME
```

Replace `XEPDB1` below with your actual Oracle service name. It is not necessarily the same as your database username or SID.[^1_6]

Run these commands from `backend/`.

### Linux/macOS

```bash
export DB_URL='jdbc:oracle:thin:@//localhost:1521/XEPDB1'
export DB_USER='login_app'
read -s -p "Oracle password: " DB_PASSWORD
echo
export DB_PASSWORD
```


### Windows PowerShell

```powershell
$env:DB_URL = "jdbc:oracle:thin:@//localhost:1521/XEPDB1"
$env:DB_USER = "login_app"
$env:DB_PASSWORD = Read-Host "Oracle password" -MaskInput
```

Compile and copy dependencies:

```bash
mvn compile dependency:copy-dependencies
```

Create your initial user.

Linux/macOS:

```bash
java -cp "target/classes:target/dependency/*" demo.CreateUser
```

Windows:

```powershell
java -cp "target/classes;target/dependency/*" demo.CreateUser
```

Enter an email and a password of at least 12 characters when prompted.

Start the backend:

```bash
mvn exec:java -Dexec.mainClass=demo.Main
```


## 5. Create the Next.js frontend

In the parent `login-project/` directory:

```bash
npx create-next-app@latest frontend
```

Choose:

- TypeScript: Yes.
- App Router: Yes.
- `src/` directory: No.
- Other options: Your preference.

Then:

```bash
cd frontend
```

Keep the generated `app/layout.tsx`.

### `frontend/.env.local`

```env
JAVA_API_URL=http://127.0.0.1:8080
```

Do not prefix this variable with `NEXT_PUBLIC_`; it is intended for server-side use only. Next.js loads `.env.local`, while variables prefixed with `NEXT_PUBLIC_` can be bundled for browser access.[^1_4]

### `frontend/app/api/auth/[action]/route.ts`

This route forwards requests to Java and stores the session token in an HTTP-only cookie. The token is not returned to browser JavaScript.

```typescript
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const backend = process.env.JAVA_API_URL;
const cookieName = "login_session";

async function handle(request: NextRequest) {
  const action = request.nextUrl.pathname.split("/").pop();

  if (!["login", "me", "logout"].includes(action ?? "")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expectedMethod = action === "me" ? "GET" : "POST";

  if (request.method !== expectedMethod) {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  // Require a same-origin browser request for state-changing operations.
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== request.nextUrl.origin
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!backend) {
    return NextResponse.json(
      { error: "Backend is not configured" },
      { status: 500 }
    );
  }

  const headers: Record<string, string> = {};

  if (action === "login") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else {
    const token = request.cookies.get(cookieName)?.value;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    let body: string | undefined;

    if (action === "login") {
      body = await request.text();

      if (new TextEncoder().encode(body).length > 8192) {
        return NextResponse.json(
          { error: "Request too large" },
          { status: 413 }
        );
      }
    }

    const upstream = await fetch(`${backend}/${action}`, {
      method: expectedMethod,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstream.json();

    const response = NextResponse.json(data, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });

    if (action === "login" && upstream.ok) {
      const token = upstream.headers.get("X-Session-Token");

      if (!token) {
        return NextResponse.json(
          { error: "Invalid backend response" },
          { status: 502 }
        );
      }

      response.cookies.set(cookieName, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 3600,
      });
    }

    if (action === "logout" && upstream.ok) {
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch {
    return NextResponse.json(
      { error: "Authentication service unavailable" },
      { status: 502 }
    );
  }
}

export const GET = handle;
export const POST = handle;
```


### `frontend/app/page.tsx`

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #eff6ff, #e0e7ff)",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <form
        onSubmit={login}
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 32,
          borderRadius: 20,
          background: "#fff",
          color: "#0f172a",
          boxShadow: "0 20px 60px rgba(15,23,42,.12)",
          display: "grid",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            Welcome back
          </h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Sign in to your account
          </p>
        </div>

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="username"
          placeholder="you@example.com"
          style={inputStyle}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          maxLength={1024}
          autoComplete="current-password"
          placeholder="Enter your password"
          style={inputStyle}
        />

        {error && (
          <p role="alert" style={{ margin: 0, color: "#dc2626" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            border: 0,
            borderRadius: 10,
            padding: 14,
            background: loading ? "#94a3b8" : "#2563eb",
            color: "#fff",
            fontSize: 16,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: 12,
  fontSize: 16,
  background: "#fff",
  color: "#0f172a",
};
```


### `frontend/app/dashboard/page.tsx`

The session is checked on the server before rendering this page.

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("login_session")?.value;

  if (!token) redirect("/");

  const backend = process.env.JAVA_API_URL;
  if (!backend) throw new Error("JAVA_API_URL is not configured");

  const response = await fetch(`${backend}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 401) redirect("/");
  if (!response.ok) throw new Error("Authentication service unavailable");

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "80px auto",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Dashboard</h1>
      <p>You are logged in successfully.</p>
      <p>Your session expires after one hour.</p>
    </main>
  );
}
```


## 6. Run and test

Keep Java running in one terminal. In another terminal, from `frontend/`:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Sign in with the account created using `CreateUser`.

Expected behaviour:

1. Correct credentials redirect to `/dashboard`.
2. Incorrect credentials show “Invalid email or password.”
3. Opening `/dashboard` without a session redirects to the login page.
4. Sessions expire after one hour.
5. Restarting Java invalidates all sessions because this starter stores sessions in memory.

To test logout from the browser’s developer console:

```javascript
await fetch("/api/auth/logout", { method: "POST" });
location.href = "/";
```


## 7. Before deploying

This starter implements credential verification and session checking, but it has not been executed against your Oracle instance.

Before production use:

- Deploy Next.js over HTTPS.
- Keep Java accessible only to the Next.js server or a private network.
- Add login rate limiting and brute-force protection; this example does not include them.
- Replace in-memory sessions with a shared session store if running multiple Java instances.
- Use a JDBC connection pool rather than opening one connection per login.
- Enforce request-size limits at the reverse proxy.
- Use a dedicated, least-privileged Oracle account.
- Add password reset, account lifecycle management, and audit logging.
- Revalidate the Origin-check configuration when deploying behind a reverse proxy.
- Select a maintained JDBC driver version compatible with your actual JDK and Oracle Database versions; Oracle documents compatibility as part of JDBC setup.[^1_7]

<span style="display:none">[^1_10][^1_11][^1_12][^1_13][^1_14][^1_15][^1_17][^1_18][^1_19][^1_20][^1_21][^1_22][^1_23][^1_24][^1_25][^1_26][^1_27][^1_28][^1_29][^1_30][^1_8][^1_9]</span>

<div align="center">⁂</div>

[^1_1]: https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html

[^1_2]: https://central.sonatype.com/artifact/com.oracle.database.jdbc/ojdbc11/23.3.0.23.09

[^1_3]: https://nextjs.org/docs/app/getting-started/route-handlers

[^1_4]: https://nextjs.org/docs/14/app/building-your-application/configuring/environment-variables

[^1_5]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

[^1_6]: https://docs.oracle.com/en/database/oracle/oracle-database/21/jjdbc/data-sources-and-URLs.html

[^1_7]: https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/JDBC-getting-started.html

[^1_8]: https://nextjs.org/docs/14/app/building-your-application/routing/route-handlers

[^1_9]: https://nextjs.org/docs/pages/guides/environment-variables

[^1_10]: https://nextjs.org/docs/app/api-reference/file-conventions/route

[^1_11]: https://clerk.com/docs/reference/nextjs/clerk-middleware

[^1_12]: https://nextjs.org/docs/pages/building-your-application/routing/api-routes

[^1_13]: https://ai-sdk.dev/docs/getting-started/nextjs-app-router

[^1_14]: https://trigger.dev/docs/guides/frameworks/nextjs

[^1_15]: https://github.com/sthagen/OWASP-CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^1_16]: https://deepwiki.com/OWASP/CheatSheetSeries/3.1-password-storage-and-hashing

[^1_17]: https://howtodoinjava.com/java/java-security/how-to-generate-secure-password-hash-md5-sha-pbkdf2-bcrypt-examples/

[^1_18]: https://github.com/rescenic/owasp-cs/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^1_19]: https://mojoauth.com/security-guides/pbkdf2-in-python

[^1_20]: https://repo1.maven.org/maven2/com/oracle/database/jdbc/ojdbc11/23.3.0.23.09/

[^1_21]: https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpsServer.html

[^1_22]: https://docs.oracle.com/en/java/javase/11/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html

[^1_23]: https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/com/sun/net/httpserver/package-summary.html

[^1_24]: https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/data-sources-and-URLs.html

[^1_25]: https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/com/sun/net/httpserver/package-use.html

[^1_26]: https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/module-summary.html

[^1_27]: https://docs.oracle.com/en/database/oracle/oracle-database/21/jajdb/oracle/jdbc/OracleDriver.html

[^1_28]: https://docs.oracle.com/javase/8/docs/jre/api/net/httpserver/spec/com/sun/net/httpserver/HttpServer.html

[^1_29]: https://github.com/bowbahdoe/jdk-httpserver

[^1_30]: https://mvnrepository.com/artifact/com.oracle.database.jdbc/ojdbc11/23.3.0.23.09


---

# Show me how to hash and verify passwords

For your Next.js + core Java + Oracle application, hash passwords in the Java backend using **PBKDF2**, then verify a login by hashing the entered password with the stored salt and comparing the results. Never store the original password or attempt to decrypt a password hash. OWASP recommends password-specific algorithms rather than plain MD5 or SHA-256; its PBKDF2-HMAC-SHA256 guidance specifies 600,000 iterations.[^2_1]

## 1. How hashing and verification work

When creating an account:

```text
Password + new random salt
            ↓
PBKDF2-HMAC-SHA256, 600,000 iterations
            ↓
Store salt and hash in Oracle
```

When logging in:

```text
Entered password + salt retrieved from Oracle
            ↓
Run the same PBKDF2 algorithm
            ↓
Compare calculated hash with stored hash
            ↓
Match → credentials are valid
```

A salt is a random value generated separately for each account. It makes identical passwords produce different stored hashes. The salt is not a secret and is stored alongside the hash. Generate a new salt when creating or changing a password—not when verifying it.[^2_2][^2_1]

## 2. Java password utility

This class is compatible with the `password_salt` and `password_hash` columns from the earlier Oracle table.

Save it as `src/main/java/demo/Passwords.java`:

```java
package demo;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public final class Passwords {

    private static final int ITERATIONS = 600_000;
    private static final int KEY_LENGTH_BITS = 256;
    private static final int SALT_LENGTH_BYTES = 16;

    private static final SecureRandom RANDOM = new SecureRandom();

    private Passwords() {}

    // Generate a new salt when creating or changing a password.
    public static String newSalt() {
        byte[] salt = new byte[SALT_LENGTH_BYTES];
        RANDOM.nextBytes(salt);

        return Base64.getEncoder().encodeToString(salt);
    }

    // Derive a password hash using a supplied salt.
    public static byte[] hash(char[] password, String salt)
            throws Exception {

        byte[] saltBytes = Base64.getDecoder().decode(salt);

        PBEKeySpec spec = new PBEKeySpec(
            password,
            saltBytes,
            ITERATIONS,
            KEY_LENGTH_BITS
        );

        try {
            SecretKeyFactory factory =
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");

            return factory.generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    // Return true only when the entered password matches.
    public static boolean verify(
            char[] enteredPassword,
            String storedSalt,
            String storedHash
    ) throws Exception {

        byte[] calculatedHash = hash(enteredPassword, storedSalt);
        byte[] expectedHash = Base64.getDecoder().decode(storedHash);

        return MessageDigest.isEqual(calculatedHash, expectedHash);
    }
}
```

`PBEKeySpec` supplies the password, salt, iteration count, and output length to `SecretKeyFactory`. Use `MessageDigest.isEqual` to compare the derived bytes instead of comparing Base64 strings with `String.equals`.[^2_3][^2_2]

Base64 only turns the salt and hash bytes into text suitable for storage; it is not encryption or password hashing.[^2_2]

## 3. Run a complete example

Save this as `src/main/java/demo/PasswordDemo.java`:

```java
package demo;

import java.util.Arrays;
import java.util.Base64;

public class PasswordDemo {

    public static void main(String[] args) throws Exception {

        // Demonstration only: production passwords come from user input.
        char[] originalPassword = "DemoPassword@123".toCharArray();
        char[] correctPassword = "DemoPassword@123".toCharArray();
        char[] wrongPassword = "WrongPassword@123".toCharArray();

        try {
            // Account creation
            String salt = Passwords.newSalt();

            String storedHash = Base64.getEncoder().encodeToString(
                Passwords.hash(originalPassword, salt)
            );

            // These two values are stored in Oracle.
            System.out.println("Salt: " + salt);
            System.out.println("Hash: " + storedHash);

            // Login verification
            boolean correct = Passwords.verify(
                correctPassword,
                salt,
                storedHash
            );

            boolean wrong = Passwords.verify(
                wrongPassword,
                salt,
                storedHash
            );

            System.out.println("Correct password accepted: " + correct);
            System.out.println("Wrong password accepted: " + wrong);

        } finally {
            Arrays.fill(originalPassword, '\0');
            Arrays.fill(correctPassword, '\0');
            Arrays.fill(wrongPassword, '\0');
        }
    }
}
```

Using the Maven backend from the previous answer:

```bash
mvn compile exec:java -Dexec.mainClass=demo.PasswordDemo
```

Expected verification output:

```text
Correct password accepted: true
Wrong password accepted: false
```

The salt and hash values will change each time you run the example because it generates a new random salt.

## 4. Store the hash in Oracle

During account creation, generate the salt and hash, then insert both using a prepared statement.

The following belongs inside your registration or user-creation method; `connection`, `email`, and `password` are inputs to that method:

```java
String salt = Passwords.newSalt();

String passwordHash = Base64.getEncoder().encodeToString(
    Passwords.hash(password, salt)
);

String sql = """
    INSERT INTO app_users (
        email,
        password_salt,
        password_hash
    )
    VALUES (?, ?, ?)
    """;

try (PreparedStatement statement = connection.prepareStatement(sql)) {
    statement.setString(
        1,
        email.trim().toLowerCase(java.util.Locale.ROOT)
    );
    statement.setString(2, salt);
    statement.setString(3, passwordHash);

    statement.executeUpdate();
}
```

Required imports:

```java
import java.sql.PreparedStatement;
import java.util.Base64;
```

Store:

```text
email
password_salt
password_hash
```

Do not store:

```text
original_password
```


## 5. Verify a password retrieved from Oracle

During login, fetch the existing salt and hash, then call `Passwords.verify()`:

```java
public static boolean verifyLogin(
        java.sql.Connection connection,
        String email,
        char[] enteredPassword
) throws Exception {

    String sql = """
        SELECT password_salt, password_hash
        FROM app_users
        WHERE email = ?
        """;

    try (java.sql.PreparedStatement statement =
            connection.prepareStatement(sql)) {

        statement.setString(
            1,
            email.trim().toLowerCase(java.util.Locale.ROOT)
        );

        try (java.sql.ResultSet result = statement.executeQuery()) {
            if (!result.next()) {
                return false;
            }

            return Passwords.verify(
                enteredPassword,
                result.getString("password_salt"),
                result.getString("password_hash")
            );
        }
    }
}
```

This illustrates database verification. For your actual HTTP login endpoint, retain the dummy-hash verification from the earlier `Main.java` example when an email is not found, and return the same “Invalid email or password” message for either failure.

Only create a login session after verification returns `true`.

## 6. Important implementation details

- Keep the algorithm, iteration count, and output length consistent between hashing and verification. Prefer storing an algorithm/version and iteration count with each password record so you can upgrade the settings later.[^2_1]
- Do not trim, lowercase, or otherwise silently change passwords. Email normalization is separate from password handling.
- Generate a fresh salt and hash whenever a password is changed.[^2_1]
- Do not log passwords; the demo’s salt/hash printing is only for learning.
- Clear caller-owned `char[]` values in a `finally` block after use. `spec.clearPassword()` clears the `PBEKeySpec` copy, not the caller’s array.[^2_3]
- PBKDF2 is useful here because Java provides it directly. OWASP generally prefers Argon2id for new password-storage implementations; using PBKDF2 does not by itself make an application FIPS-compliant.[^2_1]

<span style="display:none">[^2_10][^2_11][^2_12][^2_13][^2_14][^2_15][^2_4][^2_5][^2_6][^2_7][^2_8][^2_9]</span>

<div align="center">⁂</div>

[^2_1]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

[^2_2]: https://mojoauth.com/hashing/pbkdf2-in-java/

[^2_3]: https://compile7.org/hashing/how-to-use-pbkdf2-in-java/

[^2_4]: https://docs.oracle.com/javase/8/docs/api/java/security/MessageDigest.html

[^2_5]: https://cscode.io/java/crypto/secure-random-pbkdf2/

[^2_6]: https://github.com/OWASP/CheatSheetSeries/diffs/0?base_sha=b4e0ddeafb20db182d55e6d6c15f823e9ec26da3\&head_user=regunakyle\&name=master\&pull_number=1533\&sha1=b4e0ddeafb20db182d55e6d6c15f823e9ec26da3\&sha2=fcb5468043590165f62c565e242872c5a075f94e\&short_path=a79726f\&w=false

[^2_7]: https://github.com/axushgp/OWASP\_\_CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^2_8]: https://github.com/secureonelabs/OWASP-CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^2_9]: https://github.com/cudocharles/OWASP-CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^2_10]: https://shattered.io/pbkdf2-vs-argon2-gpu-cracking-2026/

[^2_11]: https://github.com/Web-Development-Tutorials/OWASP-CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md

[^2_12]: https://owasp.deteact.com/cheat/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

[^2_13]: https://github.com/rdwz/OWASP-CheatSheetSeries/blob/main/cheatsheets/Password_Storage_Cheat_Sheet.md

[^2_14]: https://github.com/OWASP/ASVS/issues/2991

[^2_15]: https://github.com/rescenic/owasp-cs/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md


---

# Show me how to save the salt and hash in Oracle

Save the Base64-encoded salt and password hash into separate Oracle columns using a JDBC **PreparedStatement**. Generate both values in Java with the `Passwords` class from the previous answer, then bind them to an `INSERT` statement—never insert the original password. JDBC uses `setString()` to bind text values and `executeUpdate()` to execute the insert.[^3_1]

## 1. Create the Oracle table

If you already created `app_users` from the earlier example, skip this step.

Run this in SQL Developer, connected as your application database user:

```sql
CREATE TABLE app_users (
    user_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR2(254 CHAR) NOT NULL,
    password_salt VARCHAR2(64 CHAR) NOT NULL,
    password_hash VARCHAR2(128 CHAR) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT app_users_email_unique UNIQUE (email),
    CONSTRAINT app_users_email_lower CHECK (email = LOWER(email))
);
```

This matches the table and hashing format used in your existing application.

## 2. Create a Java method to save the user

Keep `Passwords.java` unchanged from the previous answer.

Create `backend/src/main/java/demo/UserRepository.java`:

```java
package demo;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Base64;
import java.util.Locale;

public final class UserRepository {

    private UserRepository() {}

    public static void createUser(String email, char[] password)
            throws Exception {

        if (email == null || email.isBlank() || email.length() > 254) {
            throw new IllegalArgumentException("Enter a valid email.");
        }

        if (password == null || password.length < 12) {
            throw new IllegalArgumentException(
                "Password must contain at least 12 characters."
            );
        }

        String normalizedEmail =
            email.trim().toLowerCase(Locale.ROOT);

        // Generate these before opening the database connection.
        String salt = Passwords.newSalt();

        String hash = Base64.getEncoder().encodeToString(
            Passwords.hash(password, salt)
        );

        String sql = """
            INSERT INTO app_users (
                email,
                password_salt,
                password_hash
            )
            VALUES (?, ?, ?)
            """;

        try (Connection connection = DriverManager.getConnection(
                requiredEnv("DB_URL"),
                requiredEnv("DB_USER"),
                requiredEnv("DB_PASSWORD"))) {

            connection.setAutoCommit(false);

            try {
                try (PreparedStatement statement =
                        connection.prepareStatement(sql)) {

                    statement.setString(1, normalizedEmail);
                    statement.setString(2, salt);
                    statement.setString(3, hash);

                    int insertedRows = statement.executeUpdate();

                    if (insertedRows != 1) {
                        throw new SQLException(
                            "Expected to insert exactly one user."
                        );
                    }
                }

                connection.commit();

            } catch (SQLException exception) {
                try {
                    connection.rollback();
                } catch (SQLException rollbackException) {
                    exception.addSuppressed(rollbackException);
                }

                throw exception;
            }
        }
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);

        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                "Missing environment variable: " + name
            );
        }

        return value;
    }
}
```


### What gets saved?

The three placeholders map to:

```java
statement.setString(1, normalizedEmail); // email
statement.setString(2, salt);            // password_salt
statement.setString(3, hash);            // password_hash
```

Because this method disables auto-commit, `connection.commit()` makes the insert permanent. If the insert fails, the method rolls back the transaction. Oracle’s JDBC documentation describes this explicit commit/rollback pattern.[^3_2]

## 3. Call the method from an interactive terminal

Create `backend/src/main/java/demo/SaveUserDemo.java`:

```java
package demo;

import java.io.Console;
import java.sql.SQLException;
import java.util.Arrays;

public class SaveUserDemo {

    public static void main(String[] args) throws Exception {

        Console console = System.console();

        if (console == null) {
            throw new IllegalStateException(
                "Run this program from an interactive terminal."
            );
        }

        String email = console.readLine("Email: ");
        char[] password = console.readPassword("Password: ");

        try {
            UserRepository.createUser(email, password);
            System.out.println("User saved successfully.");

        } catch (SQLException exception) {
            System.err.println(
                "Could not save user. Check the database connection, "
                + "table permissions, and whether the email already exists."
            );

            // Local debugging only; do not expose this to an API client.
            System.err.println(
                "Oracle error code: " + exception.getErrorCode()
            );

        } finally {
            if (password != null) {
                Arrays.fill(password, '\0');
            }
        }
    }
}
```

This example reads the password without printing it and clears the caller’s password array after use.

## 4. Configure the Oracle connection

Use the same Oracle JDBC dependency and environment variables as your existing backend.

For example, in PowerShell 7:

```powershell
$env:DB_URL = "jdbc:oracle:thin:@//localhost:1521/XEPDB1"
$env:DB_USER = "login_app"
$env:DB_PASSWORD = Read-Host "Oracle database password" -MaskInput
```

Replace:

- `XEPDB1` with your Oracle service name.
- `login_app` with the database user that owns `app_users`.
- The database password prompt with that Oracle user’s password—not the application user’s login password.

The JDBC Thin service-name connection format is `jdbc:oracle:thin:@//host:port/service_name`.[^3_3]

From `backend/`, compile:

```bash
mvn compile dependency:copy-dependencies
```

Run on Windows:

```powershell
java -cp "target/classes;target/dependency/*" demo.SaveUserDemo
```

Run on Linux/macOS, after configuring the environment variables:

```bash
java -cp "target/classes:target/dependency/*" demo.SaveUserDemo
```

Enter the new application user’s email and password when prompted.

## 5. Confirm the row was saved

In SQL Developer, run:

```sql
SELECT
    user_id,
    email,
    LENGTH(password_salt) AS salt_length,
    LENGTH(password_hash) AS hash_length,
    created_at
FROM app_users
WHERE email = 'you@example.com';
```

Replace the email with the one you entered.

For the earlier `Passwords` class, the expected lengths are:


| Stored value | Expected Base64 length |
| :-- | --: |
| 16-byte salt | 24 characters |
| 32-byte hash | 44 characters |

Checking lengths lets you confirm that values were saved without unnecessarily displaying credential data.

## 6. Use the saved values during login

Retrieve the two columns:

```sql
SELECT password_salt, password_hash
FROM app_users
WHERE email = ?;
```

Then verify them with your existing utility:

```java
boolean valid = Passwords.verify(
    enteredPassword,
    resultSet.getString("password_salt"),
    resultSet.getString("password_hash")
);
```

Use the stored salt for verification; do not generate a new one at login. The entered password must be processed with the same salt and hashing settings used when the account was created.[^3_4]

<span style="display:none">[^3_10][^3_11][^3_12][^3_5][^3_6][^3_7][^3_8][^3_9]</span>

<div align="center">⁂</div>

[^3_1]: https://docs.oracle.com/javase/tutorial/jdbc/basics/prepared.html

[^3_2]: https://docs.oracle.com/cd/B19306_01/java.102/b14355/basic.htm

[^3_3]: https://docs.oracle.com/en/database/oracle/oracle-database/21/jjdbc/data-sources-and-URLs.html

[^3_4]: https://mojoauth.com/hashing/pbkdf2-in-java/

[^3_5]: https://download.oracle.com/otn_hosted_doc/jdeveloper/904preview/jdk14doc/docs/guide/jdbc/getstart/preparedstatement.html

[^3_6]: https://download.oracle.com/otn_hosted_doc/jdeveloper/904preview/jdk14doc/docs/guide/jdbc/getstart/statement.html

[^3_7]: https://docs.oracle.com/cd/A81042_01/DOC/java.816/a81354/oraperf1.htm

[^3_8]: https://docs.oracle.com/en/database/oracle/oracle-database/23/jjdbc/performance-extensions.html

[^3_9]: https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/performance-extensions.html

[^3_10]: https://docs.oracle.com/cd/A97630_01/java.920/a96654/oraperf.htm

[^3_11]: https://docs.oracle.com/cd/A87861_01/NT817EE/java.817/a83724/oraperf1.htm

[^3_12]: https://www.oreilly.com/library/view/java-programming-with/059600088X/ch19s02.html


---

# Show me how to structure the Next.js API route

For your application, structure the Next.js API as a **proxy** between the browser and your Java backend. Next.js receives the login request, forwards the credentials to Java, and sets the session cookie after Java verifies the password.

Use App Router `route.ts` files, with exported functions such as `POST` and `GET` for each HTTP method.[^4_1]

## 1. Folder structure

Use separate routes for login, session checking, and logout:

```text
frontend/
├── .env.local
├── lib/
│   └── auth.ts
└── app/
    ├── page.tsx
    ├── dashboard/
    │   └── page.tsx
    └── api/
        └── auth/
            ├── login/
            │   └── route.ts
            ├── me/
            │   └── route.ts
            └── logout/
                └── route.ts
```

The URL mappings are:


| File | Endpoint |
| :-- | :-- |
| `app/api/auth/login/route.ts` | `POST /api/auth/login` |
| `app/api/auth/me/route.ts` | `GET /api/auth/me` |
| `app/api/auth/logout/route.ts` | `POST /api/auth/logout` |

Next.js maps folders under `app/` to URL paths and uses `route.ts` to define the request handlers.[^4_1]

Remove the earlier `app/api/auth/[action]/route.ts` if switching to this structure.

## 2. Configure the Java backend URL

### `.env.local`

```env
JAVA_API_URL=http://127.0.0.1:8080
APP_ORIGIN=http://localhost:3000
```

`APP_ORIGIN` is the exact origin users visit in the browser. Set it to your HTTPS website origin when deploying.

Keep these variables server-side—do not add the `NEXT_PUBLIC_` prefix. Next.js exposes variables with that prefix to the browser.[^4_2]

Restart the development server after changing configuration.

## 3. Shared authentication helpers

### `lib/auth.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "login_session";

export function javaApiUrl(path: string): string {
  const baseUrl = process.env.JAVA_API_URL;

  if (!baseUrl) {
    throw new Error("JAVA_API_URL is not configured");
  }

  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function isAllowedOrigin(request: NextRequest): boolean {
  const expectedOrigin = process.env.APP_ORIGIN;

  // Fail closed if the expected origin is not configured.
  return Boolean(
    expectedOrigin &&
    request.headers.get("origin") === expectedOrigin
  );
}

export function jsonResponse(
  body: unknown,
  status: number = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function setSessionCookie(
  response: NextResponse,
  token: string
): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
```

`NextResponse.cookies.set()` adds the cookie to the response sent to the browser.[^4_3]

This example keeps the one-hour cookie lifetime aligned with the one-hour session lifetime in your Java backend.

## 4. Login route

### `app/api/auth/login/route.ts`

This remains compatible with your earlier login form, which sends URL-encoded credentials, and your Java `/login` endpoint, which returns the session token in `X-Session-Token`.

```typescript
import { NextRequest } from "next/server";
import {
  isAllowedOrigin,
  javaApiUrl,
  jsonResponse,
  setSessionCookie,
} from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return jsonResponse(
      { error: "Unsupported content type" },
      415
    );
  }

  try {
    const body = await request.text();

    if (new TextEncoder().encode(body).length > 8192) {
      return jsonResponse({ error: "Request too large" }, 413);
    }

    const form = new URLSearchParams(body);
    const email = (form.get("email") ?? "").trim();
    const password = form.get("password") ?? "";

    if (
      !email ||
      email.length > 254 ||
      !password ||
      password.length > 1024
    ) {
      return jsonResponse(
        { error: "Invalid email or password" },
        400
      );
    }

    const upstream = await fetch(javaApiUrl("/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (upstream.status === 401) {
      return jsonResponse(
        { error: "Invalid email or password" },
        401
      );
    }

    if (!upstream.ok) {
      return jsonResponse(
        { error: "Authentication service error" },
        502
      );
    }

    const token = upstream.headers.get("X-Session-Token");

    if (!token) {
      return jsonResponse(
        { error: "Invalid authentication response" },
        502
      );
    }

    const response = jsonResponse({ ok: true });
    setSessionCookie(response, token);

    return response;

  } catch {
    return jsonResponse(
      { error: "Authentication service unavailable" },
      502
    );
  }
}
```

The route does not connect to Oracle or hash passwords. Those operations stay in Java:

```text
Next.js: validate request → forward credentials → set cookie
Java: query Oracle → verify password → create session
```

The route returns only `{ "ok": true }` on success; it does not expose the session token in the JSON response.

## 5. Session-check route

### `app/api/auth/me/route.ts`

Read the session cookie and forward its value to Java as a bearer token:

```typescript
import { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  javaApiUrl,
  jsonResponse,
} from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const upstream = await fetch(javaApiUrl("/me"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (upstream.status === 401) {
      const response = jsonResponse(
        { error: "Unauthorized" },
        401
      );

      clearSessionCookie(response);
      return response;
    }

    if (!upstream.ok) {
      return jsonResponse(
        { error: "Authentication service error" },
        502
      );
    }

    return jsonResponse({ authenticated: true });

  } catch {
    return jsonResponse(
      { error: "Authentication service unavailable" },
      502
    );
  }
}
```

Cookie presence alone is not treated as authentication: the route asks Java whether the session is still valid.

## 6. Logout route

### `app/api/auth/logout/route.ts`

```typescript
import { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  isAllowedOrigin,
  javaApiUrl,
  jsonResponse,
} from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    const response = jsonResponse({ ok: true });
    clearSessionCookie(response);
    return response;
  }

  try {
    const upstream = await fetch(javaApiUrl("/logout"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return jsonResponse(
        { error: "Unable to end the session. Please try again." },
        502
      );
    }

    const response = jsonResponse({ ok: true });
    clearSessionCookie(response);

    return response;

  } catch {
    return jsonResponse(
      { error: "Authentication service unavailable" },
      502
    );
  }
}
```

This route removes the browser cookie only after Java successfully handles logout, so it does not claim the server session was revoked when the backend is unavailable.

## 7. Call these routes from your UI

Your existing login form already uses the correct endpoint. The essential request is:

```typescript
const response = await fetch("/api/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    email,
    password,
  }),
});

const data = await response.json();

if (!response.ok) {
  setError(data.error ?? "Login failed");
  return;
}

router.replace("/dashboard");
router.refresh();
```

Check the session:

```typescript
const response = await fetch("/api/auth/me", {
  cache: "no-store",
});

const data = await response.json();
```

Log out:

```typescript
const response = await fetch("/api/auth/logout", {
  method: "POST",
});

if (response.ok) {
  router.replace("/");
  router.refresh();
}
```

Keep the server-side session validation in your earlier `dashboard/page.tsx`; a browser-side check should not replace it.

For deployment, add login rate limiting and infrastructure-level request-size limits. The example’s body-length check runs after Next.js reads the body, so it is not a substitute for a reverse-proxy body limit.

<span style="display:none">[^4_10][^4_4][^4_5][^4_6][^4_7][^4_8][^4_9]</span>

<div align="center">⁂</div>

[^4_1]: https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware.md

[^4_2]: https://nextjs.org/docs/app/glossary

[^4_3]: https://nextjs.org/docs/app/api-reference/functions/next-response

[^4_4]: https://makerkit.dev/courses/nextjs-app-router/router

[^4_5]: https://nextjslaunchpad.com/article/nextjs-route-handlers-complete-guide-building-apis-app-router

[^4_6]: https://github.com/XionWCFM/Nextjs-docs-Korean-translation/blob/main/nextjsdocs/BuildingYourApplication/Routing/Route_Handlers.md

[^4_7]: https://makerkit.dev/blog/tutorials/nextjs-api-best-practices

[^4_8]: https://nextjs.org/docs/14/app/building-your-application/routing/route-handlers

[^4_9]: https://nextjs.org/docs/app/api-reference/file-conventions/route

[^4_10]: https://nextjs.org/docs/app/getting-started/route-handlers


---

# Build also new user registration

Add a **registration** page and a new API endpoint to your existing application:

```text
Registration form
    → Next.js POST /api/auth/register
    → Java POST /register
    → Hash password
    → Insert email, salt, and hash into Oracle
```

The implementation below reuses your existing `Passwords.java`, `UserRepository.java`, Oracle `app_users` table, and Next.js `lib/auth.ts`. It does not automatically log the user in after registration.

## 1. Updated folder structure

```text
backend/
└── src/main/java/demo/
    ├── Main.java                 # Add /register handling
    ├── Passwords.java            # Keep unchanged
    └── UserRepository.java       # Update validation

frontend/
├── lib/
│   └── auth.ts                  # Keep unchanged
└── app/
    ├── page.tsx                 # Existing login page
    ├── register/
    │   └── page.tsx             # New registration page
    └── api/auth/
        ├── login/route.ts
        ├── me/route.ts
        ├── logout/route.ts
        └── register/
            └── route.ts         # New registration API
```

Since your example does not implement MFA, use a minimum password length of 15 characters. OWASP’s current authentication guidance considers passwords shorter than 15 characters weak when MFA is not enabled.[^5_1]

## 2. Update Java registration validation

In `UserRepository.java`, replace the validation at the beginning of `createUser()` with:

```java
public static void createUser(String email, char[] password)
        throws Exception {

    if (email == null) {
        throw new IllegalArgumentException("Enter a valid email.");
    }

    String normalizedEmail =
        email.trim().toLowerCase(Locale.ROOT);

    // Basic application validation, not proof of email ownership.
    if (normalizedEmail.length() > 254 ||
        !normalizedEmail.matches(
            "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
        )) {
        throw new IllegalArgumentException("Enter a valid email.");
    }

    if (password == null ||
        password.length < 15 ||
        password.length > 1024) {
        throw new IllegalArgumentException(
            "Password must contain between 15 and 1024 characters."
        );
    }

    // Keep the rest of the existing method here:
    // generate salt/hash, INSERT using PreparedStatement,
    // commit on success, and roll back on failure.
```

Keep everything after the old `normalizedEmail` declaration unchanged, and do not declare `normalizedEmail` a second time.

Your existing method already generates the salt and hash and inserts them into:

```sql
INSERT INTO app_users (
    email,
    password_salt,
    password_hash
)
VALUES (?, ?, ?)
```

The database’s unique email constraint remains the final protection against duplicate accounts, including simultaneous requests. Oracle reports a uniqueness violation as `ORA-00001`.[^5_2]

## 3. Add the Java `/register` endpoint

### Add a case to `Main.handle()`

Inside the existing `switch (path)` in `Main.java`, add:

```java
case "/register" -> {
    if (!method.equals("POST")) {
        json(
            exchange,
            405,
            "{\"error\":\"Method not allowed\"}"
        );
        return;
    }

    register(exchange);
}
```


### Add this method to `Main.java`

The earlier `Main.java` already has the imports and helper methods used below.

```java
private static void register(HttpExchange exchange)
        throws Exception {

    String contentType =
        exchange.getRequestHeaders().getFirst("Content-Type");

    if (contentType == null ||
        !contentType.startsWith(
            "application/x-www-form-urlencoded"
        )) {
        json(
            exchange,
            415,
            "{\"error\":\"Unsupported content type\"}"
        );
        return;
    }

    byte[] body = exchange.getRequestBody().readNBytes(8193);

    if (body.length > 8192) {
        json(
            exchange,
            413,
            "{\"error\":\"Request too large\"}"
        );
        return;
    }

    Map<String, String> form = parseForm(
        new String(body, StandardCharsets.UTF_8)
    );

    String email = form.getOrDefault("email", "");
    String password = form.getOrDefault("password", "");
    String confirmPassword =
        form.getOrDefault("confirmPassword", "");

    if (!password.equals(confirmPassword)) {
        json(
            exchange,
            400,
            "{\"error\":\"Passwords do not match\"}"
        );
        return;
    }

    char[] passwordChars = password.toCharArray();

    try {
        UserRepository.createUser(email, passwordChars);

    } catch (IllegalArgumentException exception) {
        json(
            exchange,
            400,
            "{\"error\":\"Enter a valid email and a password "
                + "between 15 and 1024 characters\"}"
        );
        return;

    } catch (SQLException exception) {
        if (exception.getErrorCode() != 1) {
            throw exception;
        }

        // Duplicate key: return the same outward response
        // as a successful registration.
        // This starter's expected user-supplied uniqueness
        // conflict is app_users_email_unique.

    } finally {
        Arrays.fill(passwordChars, '\0');
    }

    json(
        exchange,
        200,
        "{\"message\":\"Registration request processed. "
            + "You can now try signing in.\"}"
    );
}
```

This returns the same status and message for a new account and an existing email. OWASP recommends considering generic responses for registration to reduce account enumeration. It does not eliminate every timing or other side channel.[^5_1]

For this table, duplicate email inserts produce Oracle error code `1`, which can be checked through `SQLException.getErrorCode()`.[^5_3]

Do not replace an existing account’s password when a duplicate email is submitted.

## 4. Add the Next.js registration API route

Create:

### `frontend/app/api/auth/register/route.ts`

```typescript
import { NextRequest } from "next/server";
import {
  isAllowedOrigin,
  javaApiUrl,
  jsonResponse,
} from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const contentType =
    request.headers.get("content-type") ?? "";

  if (
    !contentType.startsWith(
      "application/x-www-form-urlencoded"
    )
  ) {
    return jsonResponse(
      { error: "Unsupported content type" },
      415
    );
  }

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).length > 8192) {
      return jsonResponse(
        { error: "Request too large" },
        413
      );
    }

    const form = new URLSearchParams(rawBody);

    const email = (form.get("email") ?? "").trim();
    const password = form.get("password") ?? "";
    const confirmPassword =
      form.get("confirmPassword") ?? "";

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return jsonResponse(
        { error: "Enter a valid email address" },
        400
      );
    }

    if (password.length < 15 || password.length > 1024) {
      return jsonResponse(
        {
          error:
            "Password must contain between 15 and 1024 characters",
        },
        400
      );
    }

    if (password !== confirmPassword) {
      return jsonResponse(
        { error: "Passwords do not match" },
        400
      );
    }

    const upstream = await fetch(javaApiUrl("/register"), {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email,
        password,
        confirmPassword,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (upstream.status === 400) {
      return jsonResponse(
        { error: "Invalid registration details" },
        400
      );
    }

    if (!upstream.ok) {
      return jsonResponse(
        { error: "Registration service error" },
        502
      );
    }

    return jsonResponse({
      message:
        "Registration request processed. You can now try signing in.",
    });

  } catch {
    return jsonResponse(
      { error: "Registration service unavailable" },
      502
    );
  }
}
```

No cookie is set here. Users authenticate through your existing `/api/auth/login` endpoint after registration.

Your existing `.env.local` remains:

```env
JAVA_API_URL=http://127.0.0.1:8080
APP_ORIGIN=http://localhost:3000
```


## 5. Create the registration page

### `frontend/app/register/page.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function register(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(
      form.get("confirmPassword") ?? ""
    );

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email,
          password,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }

      formElement.reset();

      setMessage(
        data.message ??
          "Registration request processed. Try signing in."
      );

    } catch {
      setError("Unable to connect. Please try again.");

    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "linear-gradient(135deg, #eff6ff, #e0e7ff)",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <form
        onSubmit={register}
        style={{
          width: "100%",
          maxWidth: 420,
          boxSizing: "border-box",
          padding: 32,
          borderRadius: 20,
          background: "#fff",
          color: "#0f172a",
          boxShadow:
            "0 20px 60px rgba(15,23,42,.12)",
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 28,
            }}
          >
            Create an account
          </h1>

          <p style={{ margin: 0, color: "#64748b" }}>
            Enter your details to get started.
          </p>
        </div>

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="you@example.com"
          style={inputStyle}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={15}
          maxLength={1024}
          autoComplete="new-password"
          aria-describedby="password-help"
          style={inputStyle}
        />

        <small
          id="password-help"
          style={{ color: "#64748b" }}
        >
          Use at least 15 characters. A long passphrase
          works well.
        </small>

        <label htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={15}
          maxLength={1024}
          autoComplete="new-password"
          style={inputStyle}
        />

        {error && (
          <p
            role="alert"
            style={{ margin: 0, color: "#dc2626" }}
          >
            {error}
          </p>
        )}

        {message && (
          <p
            role="status"
            style={{ margin: 0, color: "#15803d" }}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            border: 0,
            borderRadius: 10,
            padding: 14,
            background: loading ? "#94a3b8" : "#2563eb",
            color: "#fff",
            fontSize: 16,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading
            ? "Creating account..."
            : "Create account"}
        </button>

        <p style={{ margin: 0, textAlign: "center" }}>
          Already have an account?{" "}
          <Link href="/" style={{ color: "#2563eb" }}>
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: 12,
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  fontSize: 16,
  background: "#fff",
  color: "#0f172a",
};
```


## 6. Add a registration link to the login page

In your existing `app/page.tsx`, add:

```tsx
import Link from "next/link";
```

Then place this below the sign-in button:

```tsx
<p style={{ margin: 0, textAlign: "center" }}>
  New user?{" "}
  <Link href="/register" style={{ color: "#2563eb" }}>
    Create an account
  </Link>
</p>
```


## 7. Run and test

Restart Java from `backend/`:

```bash
mvn compile exec:java -Dexec.mainClass=demo.Main
```

Start Next.js from `frontend/`:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/register
```

Test these cases:


| Test | Expected result |
| :-- | :-- |
| New email and valid matching passwords | Account saved; generic completion message |
| Password shorter than 15 characters | Validation error |
| Password confirmation differs | “Passwords do not match” |
| Existing email | Same completion message; existing account unchanged |
| Java backend unavailable | Service-unavailable error |
| Login with newly registered credentials | Redirect to dashboard |

Confirm the account in Oracle without displaying its hash:

```sql
SELECT
    user_id,
    email,
    LENGTH(password_salt) AS salt_length,
    LENGTH(password_hash) AS hash_length,
    created_at
FROM app_users
WHERE email = 'you@example.com';
```


## 8. Production limitations

This is a starter registration flow, not a verified-email signup system. It lets users register an email address without proving ownership.

Before making it public, add:

- Email verification before granting access.
- Registration and login rate limiting.
- A compromised-password check; OWASP recommends blocking common and breached passwords.[^5_1]
- HTTPS and infrastructure-level request-size limits.
- Monitoring and careful handling of unexpected database constraint errors.

The code above has not been run against your Oracle instance; it is designed to integrate with the files from the previous steps.

<span style="display:none">[^5_10][^5_11][^5_12][^5_13][^5_14][^5_15][^5_4][^5_5][^5_6][^5_7][^5_8][^5_9]</span>

<div align="center">⁂</div>

[^5_1]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

[^5_2]: https://docs.oracle.com/en/error-help/db/ora-00001/

[^5_3]: https://stackoverflow.com/questions/5719284/what-is-the-proper-way-to-catch-and-handle-ora-00001-sqlexception-with-jdbc

[^5_4]: https://docs.oracle.com/en/error-help/db/ora-03301/

[^5_5]: https://www.ibm.com/docs/en/idr/11.4.0?topic=trr-refreshing-data-target-cdc-replication-encountering-database-errors

[^5_6]: https://www.databasestar.com/ora-00001/

[^5_7]: https://wiki.owasp.org/images/9/9a/OWASP_Cheatsheets_Book.pdf

[^5_8]: https://github.com/nokia/OWASP-CheatSheetSeries/blob/master/cheatsheets/Authentication_Cheat_Sheet.md

[^5_9]: https://github.com/rdwz/OWASP-CheatSheetSeries/blob/main/cheatsheets/Authentication_Cheat_Sheet.md

[^5_10]: https://github.com/Web-Development-Tutorials/OWASP-CheatSheetSeries/blob/master/cheatsheets/Authentication_Cheat_Sheet.md

[^5_11]: https://github.com/Slowly-Better/OWASP-CheatSheetSeries/blob/master/cheatsheets/Authentication_Cheat_Sheet.md

[^5_12]: https://community.spiceworks.com/t/catch-handle-specific-java-sql-sqlexception-error/916588

[^5_13]: https://www.scribd.com/document/233905691/Erros-Oracle

[^5_14]: https://www.techonthenet.com/oracle/errors/ora00001.php

[^5_15]: https://blogs.oracle.com/sql/how-to-skip-duplicate-key-errors-ora-00001-in-oracle-database

