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

