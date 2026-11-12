package app.backend.userlogin;


// Import the libary to use
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public class user {
    private String username;
    private String email;
    private byte[] salt;
    private byte[] PasswordHash;

    // Initialize the user password 
    private static final int ITERATIONS = 120000;
    private static final int KEY_LENGTH = 256;

    // Constructor Value to initialize the user object
    public user(String username, String password, String email){
        this.username = username;
        this.email = email;
        setPassword(password);
    }

    // Password hashing function to hash the user password
    private void setPassword(String password){

        // Use a secure the error handling to catch any exceptions that may occur during the hashing process.
        try {
            salt = new byte[16];
            new SecureRandom().nextBytes(salt);

            PBEKeySpec spec = new PBEKeySpec(
                password.toCharArray(),
                salt,
                ITERATIONS,
                KEY_LENGTH
            );

            SecretKeyFactory factory =
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");

            byte[] enteredHash = factory.generateSecret(spec).getEncoded();

            spec.clearPassword();

            return MessageDigest.isEqual(passwordHash, enteredHash);

        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new IllegalStateException("Password verification failed", e);
        }
    }

    // Getters
    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    // Setters
    public void setUsername(String username) {
        this.username = username;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    // Getters and Setters for the user attributes
    public String getUsername(String username){
        return username;
    }

    public String getPassword(String password){
        return password;
    }
    
    public String getEmail(String email){
        return email;
    }
    
}
