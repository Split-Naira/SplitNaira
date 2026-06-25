This PR addresses two issues related to bounded operations and state transparency within the SplitNaira smart contract.  
  
Closes #667  
Closes #683  
  
## 1. Bounded Collaborator Limits (#667)  
Prior to this change, the alidate_collaborators function checked for a minimum number of collaborators (2) but lacked an upper bound. This created a potential attack vector where a project could be created with thousands of collaborators, leading to high storage consumption and excessive Soroban CPU instruction costs during distribution.  
  
**Changes:**  
- Added a MAX_COLLABORATORS constant set to 50.  
- Enforced this limit during project creation and collaborator updates.  
- Introduced a new SplitError::TooManyCollaborators (code 19).  
- Added comprehensive unit tests to ensure the bound is respected.  
  
## 2. Transparency on Split Updates with Pending Balance (#683)  
While projects are unlocked, owners can modify the splits. However, if a project had an active ProjectBalance when the splits were updated, those funds would be distributed according to the new splits rather than the old ones. While technically allowed by design, this behavior could surprise depositors and collaborators.  
  
**Changes:**  
- Introduced a new SplitsUpdatedWithPendingBalance warning event.  
- Modified update_collaborators to check the current project balance and emit this event if alance > 0.  
- Updated function documentation to clarify that split updates affect both future and current undistributed funds.  
- Added unit tests to assert the correct emission of the warning event. 
