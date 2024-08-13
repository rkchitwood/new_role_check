/**
 * node command line tool. 
 * 
 * Checks if the recorded company (in csv) of a profile with a 
 * linkedin url column matches their most recent title on LinkedIn
 * and checks if their most recent role has ended on LinkedIn.
 * Reports which roles do not match for manual updating. Result will 
 * be printed to console and can be directly pasted into doc.
 * 
 * "" for no new role, "new role" for new role.
 */

const { chromium } = require("playwright");
const fs = require('fs');
const csv = require('csv-parser');
const {LI_EMAIL, LI_PASSWORD} = require('./secret');
const LI_LOGIN_URL = "https://www.linkedin.com/login";

//extract cmnd line arguments (ONLY WORKS FOR RYAN FOR DEV, RM STRING LITERAL FOR PROD)
const csvPath = `/Users/ryanchitwood/Downloads/${process.argv[2]}`;

if (csvPath === '--help'){
    console.log("Script will iterate through CSV, uploading profiles to designated search (likely path: /users/username/Downloads/csvName.csv). Usage: node newRoleCheck.js searchName path/to/csv");
    process.exit(0);
}

if (!csvPath) {
    console.error('Error: missing arguments. Usage: node uploadProfiles.js searchName path/to/csv');
    process.exit(1);
  }

/** login to LinkedIn on login page */
async function loginToLinkedIn(page){
    await page.waitForSelector('#username');
    await page.waitForSelector('#password');
    await page.fill('#username', LI_EMAIL);
    await page.fill('#password', LI_PASSWORD);
    // BUG: "Sign in with apple ID" not ignored and prioritized
    await page.click('button:has-text("Sign in")');
}

/** awaits for manual 2FA before proceeding with script */
async function waitForManual2FA() {
    console.log('Please complete the 2FA process in the browser window.');
    console.log('Press Enter to continue after completing 2FA.');
    await new Promise(resolve => process.stdin.once('data', resolve));
}

/** iterate through csv and return array of LI profiles to visit */
function parseCsvLinks(path){
    return new Promise((resolve, reject) => {
        const urlColumn = [];
        fs.createReadStream(path)
            .pipe(csv())
            .on('data', (row) => {
                const url = row['LinkedIn URL'];
                if (url) {
                    if (url.endsWith("overlay/about-this-profile/")) {
                        urlColumn.push(url.slice(0, -27));
                    } else {
                        urlColumn.push(url);
                    }
                } else {
                    urlColumn.push("");
                }
            })
            .on('end', () => {
                resolve(urlColumn);
            })
            .on('error', (err) => {
                console.error("error reading file", err);
                reject(err);
            });
    });
}

/** iterate through csv and return array of role-companies */
function parseCsvCompanies(path){
    return new Promise((resolve, reject) => {
        const urlColumn = [];
        fs.createReadStream(path)
            .pipe(csv())
            .on('data', (row) => {
                const url = row['Company'];
                if (url) {
                urlColumn.push(url);
                }
            })
            .on('end', () => {
                resolve(urlColumn);
            })
            .on('error', (err) => {
                console.error("error reading file", err);
                reject(err);
            });
    });
}

/**
 *  helper function to format first and last name from full name and returns as array [firstName, lastName] 
 * "John Smith" => ["John", "Smith"]
 * "Dr. Jane Doe, CPA" => ["Jane", "Doe"]
*/
function formatName(fullName) {

    // removes common prefixes and suffixes
    const prefixesToOmit = ['Dr. ', 'Dr '];
    const suffixesToOmit = [' CPA', ', CPA', ',CPA',', Esq.', ' Esq.', ', MBA', ' MBA', ', M.D.', ' M.D.', ' PhD', ' Ph.D', ', PhD', ', Ph.D', ', CFA', ' CFA', ', ', ','];
    for (const prefix of prefixesToOmit) {
        if (fullName.startsWith(prefix)) {
            fullName = fullName.slice(prefix.length).trim();
            break;
        }
    }
    for (const suffix of suffixesToOmit) {
        if (fullName.endsWith(suffix)) {
            fullName = fullName.slice(0, -suffix.length).trim();
        }
    }
    const splitName = fullName.split(" ");

    // normal firstName lastName, return
    if (splitName.length === 2) return [splitName[0], splitName[1]];

    // treat middle initials or additional names as first name
    if (splitName.length > 2) return [splitName.slice(0, splitName.length - 1).join(' '), splitName[splitName.length - 1]];
}

/** 
 * helper function to format company name and remove potential suffixes
 * website.com => website
 * company, inc => company
*/
function formatCompany(companyName) {
    const suffixesToOmit = [', inc', '.com', ', llc', ', ltd', ', corp', ', ltd.', ', inc.', ' inc.'];
    for (const suffix of suffixesToOmit) {
        if (companyName.toLowerCase().endsWith(suffix)) {
            companyName = companyName.slice(0, -suffix.length);
        }
    }
    // regex to rm stock tickers or anything else in parenthesis
    companyName = companyName.replace(/\s*\(.*?\)\s*/g, '');
    return companyName.trim().toLowerCase();
}

/**
 *  helper function to format location as array [city, state, country] 
 *  "city, state, country" => ["city", "state", "country"]
 *  "metro city area" => ["metro city area", undefined, undefined]
 */
function formatLocation(locationStr) {
    const splitLocation = locationStr.split(", ");
    // handle metro city areas, profiles that only have country and non-US locations (no state)
    // if it includes "area", it is a metro area (city) and can be handled normally, otherwise it is country
    if (splitLocation.length === 1 && !splitLocation[0].includes("Area")){
        return [undefined, undefined, splitLocation[0]];
    } else if (splitLocation.length === 2) {
        return [splitLocation[0], undefined, splitLocation[1]];
    }
    return splitLocation;
}

/** 
 * helper function to accept array of unlabeled anchor links and return as object with appropriately labeled { email, URL } 
 * [href, href] => {email: "email", URL: "linkedin URL"}
*/
function parseContactData(anchorLinks){
    const contact = {};
    for (link of anchorLinks) {
        if (link.includes("linkedin")){
            contact.URL = link;
        } else if (link.includes("@")){
            contact.email = link.replace("mailto:", "");
        }
    }
    return contact;
}

/** 
 * helper functin to format tenure dates and return as [startDate, endDate] 
 * "MMM YYYY - MMM YYYY · ..." => ["MMM YYYY", "MMM YYYY"]
*/
function formatTenure(tenureString) {
    const tenureArray = tenureString.split(" - ");
    tenureArray[1] = removeDots(tenureArray[1]);
    if (tenureArray[1] === "Present") tenureArray[1] = null;
    return tenureArray;
}

/** 
 * helper function to format dates and return as [startDate, endDate] and remove months if present 
 * "MMM YYYY - MMM YYYY" => ["YYYY", "YYYY"]
 */
function formatDateYear(dateString) {
    // remove dash and dots if present and convert to array
    const formattedDates = [];
    const dates = formatTenure(dateString);
    for (let date of dates) {
        // remove month if present. Will always be YYYY or MMM YYYY
        if (date.length === 8) {
            formattedDates.push(date.slice(4));
        } else {
            formattedDates.push(date);
        }
    }
    return formattedDates;
}

/** 
 * helper function to remove the dot from company strings
 * "MMM YYYY - MMM YYYY · ..." => "MMM YYYY - MMM YYYY"
 */
function removeDots(input) {
    if (!input) return;
    const separatorIndex = input.indexOf(' · ');
    if (separatorIndex !== -1) {
      return input.substring(0, separatorIndex);
    }
    return input;
  }

/** extract profile data from LinkedIn profile and returns object
 * 
 * "https://www.linkedin.com/:username" =>
 * 
 * {firstName: "", 
 *  lastName: "", 
 *  location: {city: "", state: "", country: ""}, 
 *  contact: {email: "", URL: ""}, 
 *  experience: [{title: "", company: "", startDate: "", endDate: "", description: ""}, {...}, ...],
 *  education: [{schoolName: "", degree: "", startYear: "", endYear: "", description: ""}, {...}, ...]
 * }
 * 
 */
async function extractProfileData(profileUrl, page){
    await page.goto(profileUrl);
    const profile = {
        location: {},
        contact: {},
        experience: [],
        education: []
    };

    // extract, format and save name to profile
    const nameElement = await page.waitForSelector(".artdeco-hoverable-trigger.artdeco-hoverable-trigger--content-placed-bottom.artdeco-hoverable-trigger--is-hoverable.ember-view");
    const fullName = await page.evaluate(el => el.textContent, nameElement);
    const [firstName, lastName] = formatName(fullName.trim());
    profile.firstName = firstName;
    profile.lastName = lastName;
    
    // extract, format and save location to profile ** change .evaluate to simple .textContent?
    const locationElement = await page.waitForSelector(".text-body-small.inline.t-black--light.break-words");
    const locationStr = await page.evaluate(el => el.textContent, locationElement);
    const [city, state, country] = formatLocation(locationStr.trim());
    profile.location.city = city;
    profile.location.state = state;
    profile.location.country = country;

    //extract, format and save contact info to profile
    await page.click("#top-card-text-details-contact-info");
    await page.waitForSelector(".pv-profile-section__section-info.section-info");
    const contactAnchors = await page.$$(".pv-profile-section__section-info.section-info a");
    const anchorLinks = await page.evaluate(anchors => {
        return Array.from(anchors).map(anchor => anchor.href);
    }, contactAnchors);
    const parsedContact = parseContactData(anchorLinks);
    profile.contact = parsedContact;

    //extract, format, and save experience to profile
    // BUG: no description but has location will read location as description
    await page.waitForSelector('svg use[href="#close-medium"]');
    await page.click('svg use[href="#close-medium"]');
    const experienceSection = await page.waitForSelector('section:has(div#experience)');

    // select and iterate through each company Li section
    const companyExperienceLis = await experienceSection.$$('li.artdeco-list__item');

    for (let cxl of companyExperienceLis) {
        const roleLis = await cxl.$$('div.pvs-entity__sub-components li div.display-flex.flex-column.full-width.align-self-center');
        // if multiple roles/company, must extract each role
        if (roleLis.length > 1) {
            const companySpan = await cxl.$('a[data-field="experience_company_logo"] span');
            const companyName = removeDots(await companySpan.textContent());
            for (let rl of roleLis) {
                const role = {};
                const textSpans = await rl.$$('span[aria-hidden="true"]');
                // accomodate for job location
                if (textSpans.length === 4) {
                    // location for role
                    role.title = await textSpans[0].textContent();
                    // description not required
                    if (textSpans[3]) role.description = await textSpans[3].textContent();
                    role.company = companyName;
                    const [startDate, endDate] = formatTenure(await textSpans[1].textContent());
                    role.startDate = startDate;
                    role.endDate = endDate;
                } else {
                    // no location for role
                    role.title = await textSpans[0].textContent();
                    // description not required
                    if (textSpans[2]) role.description = await textSpans[2].textContent();
                    role.company = companyName;
                    const [startDate, endDate] = formatTenure(await textSpans[1].textContent());
                    role.startDate = startDate;
                    role.endDate = endDate;
                }
                profile.experience.push(role);
            }
        } else {
            // only one role/company
            const role = {};
            const textSpans = await cxl.$$('span[aria-hidden="true"]');
            if (textSpans.length === 5) {
                //location for role
                role.title = await textSpans[0].textContent();
                // description not required
                if (textSpans[4]) role.description = await textSpans[4].textContent();;
                role.company = removeDots(await textSpans[1].textContent());
                if (textSpans[2]) {
                    const [startDate, endDate] = formatTenure(await textSpans[2].textContent());
                    role.startDate = startDate;
                    role.endDate = endDate;
                }
            } else {
                // no location for role:
                role.title = await textSpans[0].textContent();
                // description not required
                if (textSpans[3]) role.description = await textSpans[3].textContent();;
                role.company = removeDots(await textSpans[1].textContent());
                if (textSpans[2]) {
                    const [startDate, endDate] = formatTenure(await textSpans[2].textContent());
                    role.startDate = startDate;
                    role.endDate = endDate;
                }
                
            }
            profile.experience.push(role);
        }
    }
    //extract, format, and save education to profile
    try {
        const educationSection = await page.waitForSelector('section:has(div#education)', {
            timeout: 5000
        });
        // break down each education record by Li
        const educationLis = await educationSection.$$('li.artdeco-list__item');
        for (let li of educationLis) {
            const educationRecord = {};
            //select text
            const textSpans = await li.$$('span[aria-hidden="true"]');
            // schoolName required by LinkedIn, rest optional. extract and save
            educationRecord.schoolName = await textSpans[0].textContent();
            if (textSpans[1]) educationRecord.degree = await textSpans[1].textContent();
            if (textSpans[2]) {
                const [startYear, endYear] = formatDateYear(await textSpans[2].textContent());
                educationRecord.startYear = startYear;
                educationRecord.endYear = endYear;
            }
            if (textSpans[3]) educationRecord.description = await textSpans[3].textContent();
            profile.education.push(educationRecord);
        }
    } catch {
        console.log(`No education for ${profile.firstName} ${profile.lastName}`)
    }
    return profile;
}

/** upload profiles from csv to a user-specified Thrive search */
async function compare_roles(){
      // open new browser window
      console.time("runtime");
      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      const page = await context.newPage();

      // navigate to login pages for browser auth cookies - LI has 2FA (still worth automation, can later tackle w/ browser context)
      await page.goto(LI_LOGIN_URL);
      await loginToLinkedIn(page);

      // Wait for manual 2FA completion
      await waitForManual2FA();
      
      // parse profile links from csv
      const profileUrls = await parseCsvLinks(csvPath);
      const profileCompanies = await parseCsvCompanies(csvPath);
      const newRoles = [];
      let i = 0;
      for (let profile of profileUrls) {
        try{
            if (!profile) {
                newRoles.push("REVIEW");
            } else {
                const data = await extractProfileData(profile, page);
                const currentRoles = data.experience.filter(exp => exp.endDate === null || exp.endDate === undefined);
                if (!currentRoles) {
                    newRoles.push("REVIEW");
                    i+=1;
                    continue;
                }
                const matchFound = currentRoles.some(exp => formatCompany(exp.company) === formatCompany(profileCompanies[i]));
                if (matchFound) {
                    newRoles.push("no change");
                } else {
                    newRoles.push("REVIEW");
                }
                // // title likely not to match due to data input rules, checking for company discrepancy or role enddate:
                // if (formatCompany(data.experience[0].company) !== formatCompany(profileCompanies[i]) || data.experience[0].endDate) {
                // // new role, report
                //     newRoles.push("REVIEW");
                // } else {
                // // old role, push placeholder to maintain row/column spacing
                //     newRoles.push("no change");
                // }
            }  
        } catch (err) {
            console.error(`Error extracting from ${profile} `, err);
            newRoles.push("ERROR, REVIEW");
        }
        i+=1;
        process.stdout.write(`\r${i} profiles reviewed`);
      }
    await browser.close();
    console.log(JSON.stringify(newRoles, null, 2));
    console.log("\nComplete!");
    console.timeEnd("runtime");
    process.exit(0);
}



// define and call simple async function to call uploadProfiles
(async () => {
    await compare_roles();
})();