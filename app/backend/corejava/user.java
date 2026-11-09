package app.backend.corejava;

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
    public String getUsername(String username, String password, String email){
        return username;
    }
    
}
