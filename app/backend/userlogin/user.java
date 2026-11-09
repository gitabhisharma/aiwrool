package app.backend.userlogin;

public class user {
    private String username;
    private String password;
    private String email;

    // Constructor Value to initialize the user object
    public user(String username, String password, String email){
        this.username = username;
        this.password = password;
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
