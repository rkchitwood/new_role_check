# Professional Project: New Role Check

## Description:

- **Introduction:** 
    - **New Role Check** Is an automation solution for Talent sourcing and research. It has the potential to save countless hours of automation and streamline your business.
    - It handles this by extracting URLs from a CSV, visiting their LinkedIn and subsequently flagging the profile based on whether or not their role has changed.
    - The result is a conveniently formatted array that can be pasted back into the working Excel/Google Sheets.

- **Technologies Used:**
    - NodeJS
    - csv-reader
    - Microsoft Playwright

- **Goals:**
    - The goal of this project was to automate the monotonous task of validating historical research. This tool allows teams to simply enter the needed script and sit back as the script does all of the work and reports the results.

- **Usage:**

    - Run this project via the following commands
    ```
    $ git clone https://github.com/rkchitwood/new_role_check.git
    $ cd new_role_check
    $ npm install
    $ npx install playwright
    
    # set up secret.js
    $ echo "const LI_EMAIL='your_LI_login';" > secret.js
    $ echo "const LI_PASSWORD='your_LI_password';" >> secret.js
    $ echo "module.exports={LI_EMAIL, LI_PASSWORD};" >> secret.js

    # download Excel or Google Sheet to CSV format
    # (ensure there is a 'LinkedIn URL' column - can use AppScripts to extract if needed.
    # setup complete, run:
    $ node newRoleCheck.js path/to/your/csv
    ```
    - Output can be pasted back into original column, already in order.
    ```
    [
     "no change",
     "REVIEW",
     "no change",
     ...
    ]
    ```
    
- **Contributors:**
    - This project was completed in its entirety by [Ryan Chitwood](https://github.com/rkchitwood)
